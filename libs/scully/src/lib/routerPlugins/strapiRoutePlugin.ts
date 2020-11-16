import { registerPlugin } from '../pluginManagement/pluginRepository';
import { deepGet } from '../utils/deepGet';
import { httpGetJson } from '../utils/httpGetJson';
import { HeadersObject, RouteTypeJson, RouteTypeStrapi } from '../utils/interfacesandenums';
import { logError, printProgress, yellow } from '../utils/log';
import { routeSplit } from '../utils/routeSplit';
import { HandledRoute } from './handledRoute.interface';
import { renderTemplate } from './renderTemplate';

import { request, RequestOptions } from 'https';

const getJson = function (
  url: string,
  data: string,
  { suppressErrors, headers }: { suppressErrors?: boolean; headers?: HeadersObject } = {
    suppressErrors: false,
    headers: {},
  }
): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    const { pathname, hostname, port, protocol, search, hash } = new URL(url);
    const options: RequestOptions = {
      protocol,
      hostname,
      port,
      path: pathname + search + hash,
      headers,
      method: 'POST',
    };

    const req = request(options, (res) => {
      const { statusCode } = res;

      const contentType = res.headers['content-type'];

      let error: Error;
      if (statusCode !== 200) {
        error = new Error(`Request Failed. Received status code: ${statusCode} on url: ${url}`);
      } else if (!/^application\/json/.test(contentType)) {
        error = new Error(`Invalid content-type. Expected application/json but received ${contentType} on url: ${url}`);
      }

      if (error) {
        res.resume();
        return reject(error);
      }

      res.setEncoding('utf8');
      let rawData = '';

      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          resolve(parsedData);
        } catch (e) {
          console.error(e.message);
          return reject(error);
        }
      });
    });

    req.on('error', (e) => {
      if (!suppressErrors) {
        reject(e);
      } else {
        resolve(undefined);
      }
    });

    req.write(data);
    req.end();
  });
};

export const strapiRoutePlugin = async (route: string, conf: RouteTypeStrapi): Promise<HandledRoute[]> => {
  try {
    const { params, createPath } = routeSplit(route);

    const missingParams = params.filter((param) => !conf.hasOwnProperty(param.part));
    if (missingParams.length > 0) {
      console.error(`missing config for parameters (${missingParams.join(',')}) in route: ${route}. Skipping`);
      return [
        {
          route,
          type: conf.type,
        },
      ];
    }

    printProgress(undefined, `Strapi Route plugin loading data for "${yellow(route)}"`);

    /** helper to get the data, parses out the context, and the property */
    const loadData = (param, context = {}): Promise<any[]> => {
      /** us es-template lie string to construct the url */
      const url = renderTemplate(conf[param.part].url, context).trim();
      const query = renderTemplate(conf[param.part].query, context).trim();
      return getJson(url, query, {
        headers: conf[param.part].headers,
      })
        .then((rawData) => {
          return conf[param.part].resultsHandler ? conf[param.part].resultsHandler(rawData) : rawData;
        })
        .then((rawData: any) => {
          return conf[param.part].property === undefined ? rawData : rawData.map((row) => deepGet(conf[param.part].property, row));
        });
    };

    const routes = await params.reduce(async (total, param, col) => {
      const foundRoutes = await total;
      if (col === 0) {
        /**
         * first iteration, just dump the top level in
         * and convert it to array format.
         */
        return (await loadData(param)).map((r) => [r]);
      }
      return await Promise.all(
        foundRoutes.map(async (data) => {
          const context = data.reduce((ctx, r, x) => {
            return { ...ctx, [params[x].part]: r };
          }, {});
          const additionalRoutes = await loadData(param, context);
          return additionalRoutes.map((r) => [...data, r]);
        }, [])
      ).then((chunks) => chunks.reduce((acc, cur) => acc.concat(cur)));
    }, Promise.resolve([]));

    return routes.map((routeData: string[]) => ({
      route: createPath(...routeData),
      type: conf.type,
    }));
  } catch (e) {
    logError(`Could not fetch data for route "${yellow(route)}"`);
    return [
      {
        route,
        type: conf.type,
      },
    ];
  }
};

// TODO actual validation of the config
const jsonValidator = async (conf) => {
  const { params } = routeSplit(conf.path);
  // return [yellow('all seems ok')];
  return [];
};

registerPlugin('router', 'strapi', strapiRoutePlugin, jsonValidator);
