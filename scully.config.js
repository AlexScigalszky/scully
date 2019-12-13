const demoRoutesPlugin = (route, options) => {
  console.log({route, options});
  const {createPath} = routeSplit(route);

  return Array.from({length:options.numberOfPages},(_v,k)=>k).map(n => ({route: `${createPath(`${n}`)}`, title: `Your mine ${n}`}));
};
demoRoutesPlugin[configValidator] = async config => {
  return [];
};

registerPlugin('router', 'fake', demoRoutesPlugin);

exports.config = {
  routes: {
    '/demo/:id': {
      type: 'fake',
      numberOfPages: 100
    },
  },
};