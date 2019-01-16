var electron = require('electron'),
    fs = require("fs-extra"),
    path = require("path");

    'use strict';

var JsonFileName = "window-state.json";

function deepEqual(a, b){
  if(a == b) return true;

  if(typeof a == "object" && typeof b == "object") {
    return deepEqualObj(a, b);
  } else {
    return false;
  }
}

function deepEqualObj(a, b){
  if(!a || !b) return false;

  if(typeof a == "object" && typeof b == "object") {
    var keyA = Object.keys(a);
    var keyB = Object.keys(b);
    if(keyA.length != keyB.length) return false;

    for(var i = 0; i < keyA.length; i++) {
      var curKey = keyA[i];
      var dataA = a[curKey];
      var dataB = b[curKey];
      if(deepEqual(dataA, dataB)) {

      } else {
        return false;
      }
    }
    return true;
  } else {
    return false;
  }
}

var validate = function(state){
  function hasBounds(state) {
    return state &&
      Number.isInteger(state.x) &&
      Number.isInteger(state.y) &&
      Number.isInteger(state.width) && state.width > 0 &&
      Number.isInteger(state.height) && state.height > 0;
  }

  var isValid = state && (hasBounds(state) || state.isMaximized || state.isFullScreen);

  if (!isValid) {
    state = null;
    return;
  }

  if (hasBounds() && state.displayBounds) {
    // Check if the display where the window was last open is still available
    var displayBounds = screen.getDisplayMatching(state).bounds;
    var sameBounds = deepEqual(state.displayBounds, displayBounds);
    if (!sameBounds) {
      state = null;
    } else if(state.displayBounds){
        if(state.x < state.displayBounds.x){
          state.x = state.displayBounds.x;
        } else if(state.x > state.displayBounds.x + (state.displayBounds.width || 0)){
          state.x = state.displayBounds.x;
        }
    
        if(state.y < state.displayBounds.y){
          state.y = state.displayBounds.y;
        } else if(state.y > state.displayBounds.y + (state.displayBounds.height || 0)){
          state.y = state.displayBounds.y;
        }
      }
    }
  return state;
};

function WindowStateKeeper(options){
  var app = electron.app,
      screen = electron.screen;

  var state, winRef, stateChangeTimer, confPath;

  var eventHandlingDelay = 1000;

  function readFromFile(){
    confPath = path.join(app.getPath('userData'), JsonFileName);
    try {
      var confContent = fs.readFileSync(confPath, 'utf8');
      return JSON.parse(confContent);
    } catch(e) {}
    return {};
  }

  function init(options){
    options = options || {};

    state = Object.assign(readFromFile(), options);
    state = validate(state);
    state = state || {
      width: options.width,
      height: options.height
    };
  }

  function stateChangeHandler() {
    // Handles both 'resize' and 'move'
    stateChangeTimer && clearTimeout(stateChangeTimer);
    stateChangeTimer = setTimeout(updateState, eventHandlingDelay);
  }

  function updateState(win) {
    win = win || winRef;
    stateChangeTimer && clearTimeout(stateChangeTimer);

    if (!win || win.isMinimized()) {
      return;
    }
    // don't throw an error when window was closed
    try {
      var winBounds = win.getBounds();
      if (isNormal(win)) {
        state.x = winBounds.x;
        state.y = winBounds.y;
        state.width = winBounds.width;
        state.height = winBounds.height;
      }
      state.isMaximized = win.isMaximized();
      state.isFullScreen = win.isFullScreen();
      state.displayBounds = screen.getDisplayMatching(winBounds).bounds;
    } catch (err) {}
  }

  function saveState(win) {
    if(!state) return;

    try {
      fs.outputJsonSync(confPath, state)
    } catch (err) {}
  }

  function isNormal(win) {
    return !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
  }

  function closeHandler() {
    updateState();
  }

  function closedHandler() {
    // Unregister listeners and save state
    unmanage();
    saveState();
  }

  function resetSizeToRecover(win){
    win = win || winRef;
    if(!win || win.isMinimized())

    
  }
  
  function manage(win) {
    if (state.isMaximized) {
      win.maximize();
    }
    if (state.isFullScreen) {
      win.setFullScreen(true);
    }
    win.on('resize', stateChangeHandler);
    win.on('move', stateChangeHandler);
    win.on('close', closeHandler);
    win.on('closed', closedHandler);
    winRef = win;
  }

  function unmanage() {
    if (winRef) {
      winRef.removeListener('resize', stateChangeHandler);
      winRef.removeListener('move', stateChangeHandler);
      stateChangeTimer && clearTimeout(stateChangeTimer);
      winRef.removeListener('close', closeHandler);
      winRef.removeListener('closed', closedHandler);
      winRef = null;
    }
  }

  init(options);

  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    isMaximized: state.isMaximized,
    isFullScreen: state.isFullScreen,
    manage: manage,
    unmanage: unmanage
  }
}

exports = module.exports = WindowStateKeeper;