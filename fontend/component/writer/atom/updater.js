'use strict';
// file: update.js
// author: codeskyblue
// created: 2016-01-18
// API reference: http://electron.atom.io/docs/v0.36.4/api/auto-updater/

var EventEmitter = require('events').EventEmitter;
var remote = require('electron').remote;
var app = (remote && remote.app) || require('electron').app;
var cproc = require('child_process');
var path = require('path');
var https = require('https');
var http = require('http');
var fs = require('fs');
var parseUrl = require('url').parse;

var updater = new EventEmitter();
var feedURL = "http://localhost:3333/test.json";
var errCancel = new Error("cancel");
var setupPath = path.join(process.env.TEMP|| app.getPath('temp'), 'typora-upgrade.exe');

function makeRequest(url){
  var p = parseUrl(url);
  var module = (p.protocol === 'https:' ? https : http);

  var req = module.request({
    method: 'GET',
    hostname: p.hostname,
    path: p.path,
    port: p.port,
    maxRedirect: 3
  });
  return req;
}

/**
 * @param {String} url
 * @return {Promise}
 */
function request(url) {
  return new Promise(function(resolve, reject) {
    var req = makeRequest(url);

    req.on('response', function(res) {
      var chunks = [];
      res.on('data', function(chunk) {
        chunks.push(chunk)
      });
      res.on('end', function() {
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks).toString('utf-8')
        })
      })
    });
    req.end();
    req.on('error', function(error) {
      reject(error)
    })
  })
}

function download(url, dst){
  return new Promise(function(resolve, reject){
    var file = fs.createWriteStream(dst);
    var req = makeRequest(url);
    req.on('response', function(res){
      res.pipe(file)
    });
    req.on('error', function(err){
      reject(err)
    });
    req.end();
    
    file.on('finish', function(){
      resolve(dst)
    })
  })
}

updater.setFeedURL = function(url){
  feedURL = url;
};

updater.checkForUpdates = function(isForce){
  console.debug("checkForUpdates " + feedURL);
  if (!feedURL) {
    updater.emit('error', 'need to call before setFeedURL');
    return;
  }
  updater.emit('checking-for-update')

  /*request(feedURL)
    .then(res => {
      if (res.statusCode != 200 && response.statusCode != 204){
        throw new Error('invalid status code: ' + response.statusCode)
      }
      if (res.statusCode == 204) {
        this.emit('update-not-available')
        return Promise.reject(errCancel)
      }
      console.debug('update check, get ' + res.body);
      var data = JSON.parse(res.body)
      if(! (app.setting.compareVersion(data.version, app.getVersion()) > 0)){
        this.emit('update-not-available')
        return Promise.reject(errCancel)
      }

      console.debug("update-avaliable");
      this.emit('update-avaliable');
      this.feedData = data;
      setupPath = path.join(process.env.TEMP|| app.getPath('temp'), 'typora-update-' + (data.version).replace(/[.]/g, '_') + '.exe');
      console.debug("download from " + data.download["x64"] + " to " + setupPath);

      return download(data.download["x64"], setupPath);
    })
    .then(dest =>{
      var data = this.feedData;
      this.emit('update-downloaded', {
        releaseNotes: data.changelog,
        releaseName: data.name,
        releaseDate: data.date,
        updateURL: data.updateURL,
      })
    })
    .catch(err => {
      if (err === errCancel){
        console.log("Cancel")
      } else {
        this.emit('error', err)
      }
    })*/
};

updater.quitAndInstall = function(){
  cproc.spawn(setupPath, ['/SILENT'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  }).unref();

  app.quit();
};



module.exports = updater;