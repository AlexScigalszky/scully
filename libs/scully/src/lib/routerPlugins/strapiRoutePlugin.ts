import { registerPlugin } from '../pluginManagement/pluginRepository';
import { deepGet } from '../utils/deepGet';
import { httpGetJson } from '../utils/httpGetJson';
import { HeadersObject, RouteTypeJson, RouteTypeStrapi } from '../utils/interfacesandenums';
import { logError, printProgress, yellow } from '../utils/log';
import { routeSplit, SplitRoute } from '../utils/routeSplit';
import { HandledRoute } from './handledRoute.interface';
import { renderTemplate } from './renderTemplate';

import { request, RequestOptions } from 'https';
import { forkJoin, from, Observable, Observer, of, Subscriber } from 'rxjs';
import { map, merge, mergeMap, reduce } from 'rxjs/operators';

const getJson = function (
  url: string,
  data: string,
  { suppressErrors, headers }: { suppressErrors?: boolean; headers?: HeadersObject } = {
    suppressErrors: false,
    headers: {},
  }
): Observable<any> {
  const { pathname, hostname, port, protocol, search, hash } = new URL(url);
  const options: RequestOptions = {
    protocol,
    hostname,
    port,
    path: pathname + search + hash,
    headers,
    method: 'POST',
  };

  return new Observable<any>((subscriber: Subscriber<any>) => {
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
        return subscriber.error(error);
      }

      res.setEncoding('utf8');
      let rawData = '';

      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          subscriber.next(parsedData);
          subscriber.complete();
        } catch (e) {
          console.error(e.message);
          subscriber.error(error);
        }
      });
    });

    req.on('error', (e) => {
      if (!suppressErrors) {
        subscriber.error(e);
      } else {
        subscriber.next(undefined);
      }
    });

    req.write(data);
    req.end();
  });
};

export const strapiRoutePlugin = async (route: string, conf: RouteTypeStrapi): Promise<HandledRoute[]> => {
  try {
    const { params, createPath } = routeSplit(route);

    const missingParams = params.filter((param: SplitRoute) => !conf.hasOwnProperty(param.part));
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
    const loadData = (param, context = {}): Observable<any[]> => {
      /** us es-template lie string to construct the url */
      const url = renderTemplate(conf[param.part].url, context).trim();
      const query = renderTemplate(conf[param.part].query, context).trim();

      return getJson(url, query, {
        headers: conf[param.part].headers,
      }).pipe(
        map((rawData: any) => (conf[param.part].resultsHandler ? conf[param.part].resultsHandler(rawData) : rawData)),
        map((rawData: any) =>
          conf[param.part].property === undefined ? rawData : rawData.map((row) => deepGet(conf[param.part].property, row))
        )
      );
    };

    /**
     * Helper to reduce all routes to an array
     * @param total
     * @param param
     * @param col
     */
    const reduceFn = (total: any[], param: any, col: number): Observable<Array<any>> => {
      const foundRoutes = total;
      if (col === 0) {
        /**
         * first iteration, just dump the top level in
         * and convert it to array format.
         */
        return loadData(param).pipe(map((r) => [r]));
      }
      /**
       * Load data for each route founded
       */
      const routesData = foundRoutes.map((data: any) => {
        const context = data.reduce((ctx: any, r: any, x: string | number) => ({ ...ctx, [params[x].part]: r }), {});

        return loadData(param, context).pipe(map((r) => [...data, r]));
      }, []);

      /**
       * Join all route data
       */
      return forkJoin(routesData.map((x) => x)).pipe(map((chunks) => chunks.reduce((acc, cur) => acc.concat(cur))));
    };
    /**
     * helper to convert an array of string to a HandledRoute
     * @param routeData
     */
    const arrayStringToHandledRoute = (routeData: string[]): HandledRoute => ({
      route: createPath(...routeData),
      type: conf.type,
    });

    const routes$ = of(params).pipe(
      reduce(reduceFn, []),
      map((routes) => routes.map(arrayStringToHandledRoute))
    );

    return routes$.toPromise();
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
