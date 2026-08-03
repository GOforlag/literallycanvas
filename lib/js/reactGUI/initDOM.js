'use strict';

var React = require('./React-shim');
var ReactDOM = require('./ReactDOM-shim');
var LiterallyCanvasModel = require('../core/LiterallyCanvas');
var LiterallyCanvasReactComponent = require('./LiterallyCanvas');

function init(el, opts) {
  var originalClassName = el.className;
  var lc = new LiterallyCanvasModel(opts);

  // Use createRoot API for React 18+, fallback to render for older versions
  var root = void 0;
  if (ReactDOM.createRoot) {
    root = ReactDOM.createRoot(el);
    root.render(React.createElement(LiterallyCanvasReactComponent, { lc: lc }));
  } else {
    ReactDOM.render(React.createElement(LiterallyCanvasReactComponent, { lc: lc }), el);
  }

  lc.teardown = function () {
    lc._teardown();
    if (root && root.unmount) {
      root.unmount();
    } else {
      ReactDOM.unmountComponentAtNode(el);
    }
    el.className = originalClassName;
  };
  return lc;
}

module.exports = init;