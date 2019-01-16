(function(){
	var path = require("path"),
		t_workingDir = path.join(__dirname, "../");
	var Module = require("module");

	Module.globalPaths.push(path.join(t_workingDir, "node_modules.asar"));
	Module.globalPaths.push(__dirname);

	var _old_require = Module.prototype.require;
	Module.prototype.require = function(id){
		if(/(\.node$)|(\/build\/Release)/.exec(id) && id[0] == ".") {
			id = path.resolve(path.dirname(this.id), id).replace(/\bnode_modules\.asar\b/, 'node_modules');
		}
		return _old_require.call(this, id);
	};
})();

var electron = require('electron'),
	app = electron.app,
	protocol = electron.protocol,
	Menu = electron.Menu,
	BrowserWindow = electron.BrowserWindow,
	fs = require('fs-extra'),
	winSparkle = null,
	isWin = process.platform == 'win32',
	isMac = process.platform == 'darwin',
	isLinux = process.platform == 'linux',
	Setting = require('Setting.js'),
	menuHelper = require('menu.js'),
	documentController = require('DocumentController.js'),
	ipc = electron.ipcMain,
	Raven = require('raven'),
	Countly = require('countly-sdk-nodejs');

var shouldQuit = app.makeSingleInstance(function(argv, workingDirectory){
	console.log(argv);
	if(BrowserWindow.getAllWindows().length){
		app.openFileOrFolder(getFilePath(argv, workingDirectory));
		/*if(isLinux && process.argv.length <= 1){
			readStdin(mainWindow);
		}*/
	}
});

var ReopenType = {
	FOLDER: 1,
	FILE: 2,
	CUSTOM: 3
};

if (shouldQuit) {
  console.log("secondary instance would exit");
  app.quit();
  return;
}

function initAutoUpdate(){
	if(isWin){
		winSparkle = require("winsparkle-node");
		winSparkle.setAppcastUrl("https://www.typora.io/windows/dev_update.xml");
		winSparkle.init();
		winSparkle.setAutomaticCheckForUpdates(app.setting.get("enableAutoUpdate", true));
	}
}

function getFilePath(argv, workingDirectory) {
	var path;
	if (argv.length > 1) {
		path = argv[argv.length - 1];
	}
	if(workingDirectory == undefined){
		workingDirectory =  process.cwd();
	}
	if(path && /^file:\/\//i.exec(path)){
		path = path.replace(/^file:\/\//i, "");
		try {
			path = decodeURI(path);
		} catch(e){}
	}
	// path = path.replace(/[\\]$/, '');
	return path /*&& path.match(/[^\\/.]$/)*/ ? require("path").resolve(workingDirectory, path) : undefined;
}


app.backups = {};

app.removeBackup = function(windowId){
	delete app.backups[windowId];
	//app.syncBackups(undefined);
};

app.addBackup = function(backup){
	if(backup.path){
		Object.keys(app.backups).forEach(function(k){
			if(backup.path && app.backups[k].path == backup.path){
				delete app.backups[k];
			}
		});
	}

	app.backups[backup.id] = backup;
	app.syncBackups(backup.id);
};

app.syncBackups = function(id, onQuit){
	var folder = app.getPath("userData") + "/backups";

	function writeAfterEnsureFolder(err){
		if(err) {
			console.log("Error on creating baclup folder " + err.stack);
			return;
		}

		var backupList = Object.values(app.backups);

		var summary = {
			innormalQuit: !onQuit,
			windows: backupList.map(function(b){
				return {
					id: b.id,
					path: b.path,
					encode: b.encode,
					useCRLF: b.useCRLF,
					hasUnsaved: b.hasUnsaved,
					scrollPos: b.scrollPos,
					syncDate: b.syncDate,
					mountFolder: b.mountFolder
				}
			})
		};

		if(onQuit){
			summary.windows.forEach(function(w){
				if(w.hasUnsaved){
					summary.innormalQuit = true;
				}
			});
			if(!summary.windows.length) {
				summary.windows = lastClose.map(function(win, i){
					win.id = i;
					return win;
				});
			}
			try {
				fs.writeFileSync(folder + "/sum", JSON.stringify(summary));
			} catch(err){
				console.log("Error on saving backups " + err.stack);
			}
		} else {
			fs.writeFile(folder + "/sum", JSON.stringify(summary), function(err){
				if(err) {
					console.log("Error on saving backups " + err.stack);
				}
			});
		}
		

		if(id !== undefined || id !== null){
			var b = app.backups[id];
			if(b && b.hasUnsaved){
				fs.writeFile(folder + "/" + b.id, b.content, function(err){
					if(err) {
						console.log("Error on saving backups " + err.stack);
					}
				});
			}
		}
	}

	if(onQuit) {
		try {
			fs.ensureDirSync(folder);
			writeAfterEnsureFolder();
		} catch(e){
			console.log("Error on creating baclup folder " + e.stack);
		}
	} else {
		fs.ensureDir(folder, writeAfterEnsureFolder);
	}
};

var inBatchClosing;
var inBatchClosingTimer;
var lastClose = [];

app.onCloseWin = function(id, mountFolder){
	var win = BrowserWindow.fromId(id);
	var doc = app.getDocumentController().getDocumentFromWindowId(id);
	var bounds = win.getBounds();
	var filePath = doc.path;
	app.getDocumentController().removeWindow(win.id);
	app.removeBackup(id);

	if(!inBatchClosing){
		inBatchClosing = true;
		lastClose = [];
	}
	inBatchClosingTimer && clearTimeout(inBatchClosingTimer);
	inBatchClosingTimer = setTimeout(function(){
		inBatchClosing = false;
		inBatchClosingTimer = null;
		app.setting.save();
	}, 500);

	lastClose.push({
		path: filePath, 
		mountFolder: mountFolder
	});
};

ipc.on("addBackup", function(event, data){
	data.id = BrowserWindow.fromWebContents(event.sender).id;
	app.addBackup(data);
});

app.currentFocusWindowId = null;

app.getCurrentFocusWindowId = function(){
	return app.currentFocusWindowId; 
};

ipc.on("setFocusWindow", function(event, data){
	app.currentFocusWindowId = BrowserWindow.fromWebContents(event.sender).id;
});

ipc.on("countly_add_event", function(event, data){
	data.segmentation = Object.assign(data.segmentation || {}, {os: process.platform});
	Countly.add_event(data);
});

app.reopenFolder = function(){
	var openedFolder = new Set(),
		opened = false;

	lastClose.forEach(function(l){
		if(l.mountFolder && !openedFolder.has(l.mountFolder)){
			openedFolder.add(l.mountFolder);
			app.switchFolder(l.mountFolder, app.openFile(null, {
				forceCreateWindow: true
			}).activeWindow, true);
			opened = true;
		}
	});
	return opened;
};

app.reopenClosed = function(onInit){
	console.debug("reopenClosed");
	var opened = false;
	if(lastClose.length){
		lastClose.forEach(function(item){
			var doc = app.getDocumentController().getDocument(item.path);
			if(doc){
				doc.activeWindow && doc.activeWindow.show();
			} else if(onInit || item.path){
				app.openFile(item.path, {
					forceCreateWindow: true,
					mountFolder: item.mountFolder,
					slient: onInit
				});
				opened = true;
			}
		});
	}
	return opened;
};

var normalOpen = function(){
	var openType = app.setting.get("restoreWhenLaunch") || 0;
	var needDefault = true;
	try {
		if(openType == ReopenType.FOLDER){
			console.debug("reopen folder");
			needDefault = !app.reopenFolder();
		} else if(openType == ReopenType.FILE){
			console.debug("reopen file");
			needDefault = !app.reopenClosed(true);
		} else if(openType == ReopenType.CUSTOM){
			var pinFolder = app.setting.get("pinFolder");
			console.debug("pinFolder " + pinFolder);
			if(pinFolder){
				app.switchFolder(pinFolder, app.openFile(null, {
					forceCreateWindow: true
				}).activeWindow, "pinFolder");
				needDefault = false;
			}
		}
	} catch(e){
		console.warn(e.stack);
	}
	
	if(needDefault) {
		app.openFileOrFolder();
	}
};

app.recoverFromBackup = function(force){
	var folder = app.getPath("userData") + "/backups";

	var recoverWindow = function(winState){
		var doc = app.openFile(winState.path, {
			forceCreateWindow: true,
			mountFolder: winState.mountFolder
		});
		try {
			if(winState.hasUnsaved){
				var content = fs.readFileSync(folder + "/" + winState.id, 'utf8');
				if(content.length < 500 * 1000){
					winState.content = content;
					doc.backupState = winState;
				} else {
					console.log("abort recovery: file too large");
					winState.hasUnsaved = false;
				}
			}
		} catch(e){
			console.log("failed to read backup " + e.stack);
		}
	};
	
	fs.readFile(folder + "/sum", "utf8", function(err, str){
		if(err || !str) return normalOpen();
		try {
			var sum = JSON.parse(str);
			lastClose = sum.windows.filter(function(winState){
				return winState.path || winState.mountFolder;
			}).map(function(winState){
				return {path: winState.path, mountFolder: winState.mountFolder};
			});

			sum.windows = sum.windows.filter(function(winState){
				return winState.path || winState.content;
			});

			if(!force && (!sum.windows.length || !sum.innormalQuit)){
				normalOpen();
			} else {
				sum.windows.forEach(recoverWindow);
			}
		} catch(e){
			app.openFileOrFolder();
			console.log("failed to read backup " + e.stack);
		}        
	});
};

// Report crashes to our server.
// require('crash-reporter').start();

/** ------ main() -------*/
app.on('ready', function() {
	app.setting.init();
	console.log("------------------start------------------");
	console.log("typora version: " + app.getVersion());
	bindRequestProxy();

	app.setAppUserModelId("abnerworks.Typora");
	console.debug(process.argv);

	var filePath = getFilePath(process.argv);
	if(filePath && process.argv[process.argv.length - 1] !== "--on-dev"){
		app.openFileOrFolder(filePath);
	} else {
		app.recoverFromBackup();
	}

	menuHelper.bindMainMenu();

	bindDownloadingEvents();

	setTimeout(function(){
		initAutoUpdate();

		/*(function initSpellChecker() {
			try {
				var SpellChecker = require("spellchecker");
				SpellChecker.add("Typora");
				SpellChecker.add("typora");
			} catch (e) {
				console.error("Cannot find module spellchecker " + e.message);
				Raven.captureException(e);
			}
		})();*/
		cleanUpExpiredDrafts();
	}, 1000);
});

var cleanUpExpiredDrafts = function(){
	var dir = require("path").resolve(app.getPath("userData"), "draftsRecover");

	fs.readdir(dir, function(err, files){
		if(!err && files.length >= 100){
			files.map(function(v){
				return {
					name: v,
					time:fs.statSync(dir + "/" + v).mtime.getTime()
				}
			}).sort(function(a, b) {
			   return a.time - b.time
			}).forEach(function(f, i){
				i > 59 && fs.unlink(dir + "/" + f.name);
			});
		}
	});
};

/** --------------------- */
app.on('window-all-closed', function() {
	app.quit();
});
app.on('before-quit', function() {
	Countly.end_session();
	app.syncBackups(null, true);
	console.log("------------------quit------------------");
	app.setting.closeLogging();
});
app.on('will-quit', function() {
	console.log("------------------will-quit------------------");
	winSparkle && winSparkle.cleanup();
	inBatchClosingTimer && clearTimeout(inBatchClosingTimer);

	app.setting.syncAll();
	try {
		var newPath = app.getPath("userData") + '/typora.log',
			oldPath = app.getPath("userData") + '/typora-old.log',
			lastLog = fs.statSync(newPath);
		
		if(lastLog && lastLog.size > 500000){
			if(fs.existsSync(oldPath)){
				fs.unlinkSync(oldPath);
			}
			fs.renameSync(newPath, oldPath);
		}
	} catch(e){
		console.error(e);
	}
});

//var opQueue = [];
opQueueRuning = false;

app.opQueue = [];

var runOpQueue = function(){
	function wrapExeFunc(){
		return new Promise(function(resolve, reject){
			var top = app.opQueue.shift(),
				win = top[0],
				done = false;
			try {
				if(win.webContents.isDestroyed() || win.webContents.isLoadingMainFrame() || win.webContents.isCrashed()){
					done = true;
					resolve();
					return;
				}
				win.webContents.executeJavaScript(top[1]).then(function(){
					done = true;
					resolve();
				}, function(){
					console.debug("exec " + top[1] + " error ");
					reject("wrapExeFunc Error on js execution");
				});
			} catch(e){
				done = true;
				opQueueRuning = false;
				reject("wrapExeFunc " + e.message);
				return;
			}
			setTimeout(function(){
				if(done) return;
				try {
					console.debug("path " + app.getDocumentController().getDocumentFromWindowId(win.id).path + ", win.id = " + win.id);
					reject("wrapExeFunc Timed out " + 
					(top[1]||"").match(/^.{0,50}/)[0]);
				} catch(e){console.warn(e)}
			}, 4000);
		});
	}

	function wrapNextFunc(){
		opQueueRuning = false;
		runOpQueue();
	}

	if(app.opQueue.length == 0){
		opQueueRuning = false;
	} else if(!opQueueRuning){
		opQueueRuning = true;
		wrapExeFunc().then(wrapNextFunc, function(msg){
			console.error(msg);
			Raven.captureMessage(msg, {level: "error"});
			wrapNextFunc();
		});
	}
};

app.addAndExecute = function(window, command){
	app.opQueue.push([window, command]);
	runOpQueue();
};

app.on("browser-window-blur", function(event, window){
	app.addAndExecute(window, "window.onWindowBlur && window.onWindowBlur()");
});

app.on("browser-window-focus", function(event, window){
	app.addAndExecute(window, "window.onWindowFocus && window.onWindowFocus()");
});

app.getWorkingDir = function(){
	return __dirname + "../";
};

app.getDocumentController = function(){
	return documentController;
};

app.documentController = documentController;

app.openFolder = function(folder, win){
	if(win){
		var doc = documentController.getDocumentFromWindowId(win.id);
		if(doc && !doc.path){
			app.switchFolder(folder, win);
			return;
		}
	}
	Countly.add_event({key: "openFolder", segmentation: {os: process.platform}});
	return app.switchFolder(folder, app.openFile().activeWindow, 500);
};

app.switchFolder = function(folder, win, slient, deploy){
	slient = slient || false;
	if(typeof slient == "string"){
		slient = JSON.stringify(slient);
	}
	win = win || BrowserWindow.getFocusedWindow();
	if(!win) return;
	var folderVal = JSON.stringify(folder);
	var script = "File.option && (File.option.pinFolder = " + folderVal + ");\n File.editor && File.editor.library && File.editor.library.setMountFolder(" + JSON.stringify(folder) + ", true, " + slient + ")";
	setTimeout(function(){
		win.webContents.executeJavaScript(script);
	}, deploy ? deploy : 0);
	return win;
};

app.openFileOrFolder = function(path, option){
	if(path && require("fs-plus").isDirectorySync(path)){
		app.openFolder(path);
	} else {
		app.openFile(path, option);
	}
};

/**
 * @return new window if syncAndPrepOnly = true
 */
app.openFile = function(path, option) {
	option = option || {};
	console.debug('app.openFile');

	var win = option.curWindow || BrowserWindow.getFocusedWindow(),
		syncAndPrepOnly = option.syncAndPrepOnly,
		forceCreateWindow = option.forceCreateWindow;

	path = path && require("path").normalize(path);

	function decideOpenInWhichWindow(openInCurWindow){
		if(openInCurWindow){
			win.webContents.executeJavaScript("File.editor.library.openFile(" + JSON.stringify(path) + ")");
		} else {
			doOpenInNewWindow()
		}
	}

	function doOpenInNewWindow(){
		var doc = documentController.openFile(path, {
			prepWindow: true,
			displayNow: forceCreateWindow || !syncAndPrepOnly,
			forceCreateWindow: forceCreateWindow,
			slient: option.slient
		});
		doc.activeWindow.initMountFolder = option.mountFolder;
		return doc;
	}

	if(!syncAndPrepOnly && path && !forceCreateWindow){
		if (win && !win.webContents.isLoadingMainFrame()) {
			var doc = documentController.getDocumentFromWindowId(win.id);
			if(doc && !doc.path){
				win.webContents.executeJavaScript("File.changeCounter.isDiscardableUntitled()").then(decideOpenInWhichWindow, doOpenInNewWindow);
				return doc;
			}
		}
	}

	return doOpenInNewWindow();
};

app.sendEvent = function(eventType, data){
	BrowserWindow.getAllWindows().forEach(function(win){
		win.webContents.send(eventType, data);
	});
};

app.refreshMenu = function(){
	menuHelper.refreshMenu();
};

var imageSaveMap = {};

app.download = function(id, url, folder){
	var webContents = electron.webContents.fromId(id);
	var saveMap = imageSaveMap[id] || {};
	imageSaveMap[id] = saveMap;
	if(!saveMap[url]){
		saveMap[url] = folder;
		webContents.downloadURL(url);
	}
};

function uniqueFilePathOnNode(dest){
	var path = require("path");
	return dest.replace(/(\.[^.\/\\]+?$)/, '') + "-" + (new Date() - 0) + path.extname(dest)
}

var bindDownloadingEvents = function(){
	var defaultSession = electron.session.defaultSession; 
	defaultSession.on('will-download', function(event, item, webContents){
		var url = item.getURLChain()[0];
		if(/(dic|aff|LICENSE)$/.exec(url)) {
			return;
		}

		var saveMap = imageSaveMap[webContents.id];
		var folder = saveMap && saveMap[url];
		var path = require("path"),
			fs = require("fs");
		var fileName = item.getFilename();
		var dest = path.join(folder || "", fileName);

		if(!folder) {
			console.debug("cancel url " + url);
			item.cancel();
			event.preventDefault();
		} else {
			if(fs.existsSync(dest)){
				dest = uniqueFilePathOnNode(dest);
			}
			item.setSavePath(dest);
			delete saveMap[url];
		}

		item.once('done', function(event, state){
			if(dest){
				webContents.executeJavaScript("window.onImageDownloaded && window.onImageDownloaded(" + JSON.stringify(url) + ", " + JSON.stringify(state) + ", " + JSON.stringify(dest) + ")");
			}
		});
		item.on("updated", function(event, state){
			if(dest && (state == "cancelled" || state == "interrupted")){
				webContents.executeJavaScript("window.onImageDownloaded &&window.onImageDownloaded(" + JSON.stringify(url) + ", " + JSON.stringify(state) + ")");
			}
		})
	});

	var filter = {
		urls: ['file://**.*/*']
	};
	var wrongProtocolReg = /^file:\/\/([a-z0-9\-_]+\.)+([a-z]+)\//i;

	defaultSession.webRequest.onBeforeRequest(filter, function(details, callback){
		var url = details.url;
		if(wrongProtocolReg.exec(url)) {
			url = "https" + url.substr(4);
			console.log("redirect to " + url);
			callback({cancel: false, redirectURL: url});
		} else {
			callback({cancel: false});
		}
	});
};

var bindRequestProxy = function(){
	protocol.registerFileProtocol("typora", function(request, callback) {
	  var url = request.url.substr(9).replace("userData", app.getPath("userData").replace(/\\/g, "\\\\")).replace("current-theme.css", app.setting.getCurrentTheme());
	  callback({path: url});
	}, function (error) {
	  if (error)
		console.error(error)
	});
};

app.forceRefreshMenu = function(){
	if(isLinux){
		// https://github.com/typora/typora-issues/issues/1206
		Menu.setApplicationMenu(Menu.getApplicationMenu());
	}
};


var cachedMenuItems_;

var getMenuItem = function(key){
	if(!key) return null;

	var item = cachedMenuItems_[key];
	if(item) return item;

	var comps = key.split("→");
	var prePath;
	comps.forEach(function(c){
		item = getMenuItemUnder(c, item);
		if(!prePath) {
			prePath = c;
		} else {
			prePath = prePath + "→" + c;
		}
		cachedMenuItems_[prePath] = item;
		if(!item) return null;
	});
	return item;
};

var getMenuItemUnder = function(key, menuItem){
	var menu = menuItem ? menuItem.submenu : Menu.getApplicationMenu();
	if(menu) {
		return menu.getItem(key);
	}
	return null;
};

app.updateMenu = function(updates) {
	cachedMenuItems_ = {};

	for(var key in updates) {
		var item = getMenuItem(key),
			data = updates[key];

		if(!item) continue;
		
		if(data.state !== undefined){
			item.checked = data.state;
		}
		if(data.enabled !== undefined){
			item.enabled = data.enabled;
			if(key == "Paragraph" || key == "Format") {
				item.submenu.items.forEach(function(menuItem){
					menuItem.enabled = data.enabled;
				});
			} 
		}
		if(data.hidden !== undefined){
			item.visible = !data.hidden;
		}
	}

	cachedMenuItems_ = null;

	if(isLinux) {
		app.forceRefreshMenu();
	}
};

ipc.on('menu.updateMenu', function(event, arg) {
	app.updateMenu(arg);
});