var electron = require('electron'),
		app = electron.app,
		ipcMain = electron.ipcMain,
		BrowserWindow = electron.BrowserWindow,
		shell = electron.shell,
		fs = require("fs"),
		fsp = require("fs-plus"),
		util = require("util"),
		isWin = process.platform == 'win32',
		isMac = process.platform == 'darwin',
		isLinux = process.platform == 'linux',
		windowStateKeeper = require('WindowState.js'),
		Raven = require('raven'),
		Countly = require('countly-sdk-nodejs'),
		t_workingDir = require("path").join(__dirname, "../");

var Document = function(path, win){
		this.activeWindow = win || null;
		this.windows = win ? new Set(win) : new Set(win);
		this.path = path || null;
		this.snap = null;
		this.lastSync = new Date() - 0;
		this.content;
};

Document.prototype.setContent = function(content){
	this.content = content;
};

Document.prototype.getContent = function(){
	return this.content;
};

Document.prototype.switchToUntitled = function(){
	if(!this.path) return;

	this.rename(null);
	this.windows.forEach(function(win){
		 	win.webContents.executeJavaScript("window.clientHanlderOnPresentationMoved()");
	}, this);
};

Document.prototype.rename = function(newPath){
	if(wrapPathAsKey(this.path) == wrapPathAsKey(newPath || "")){
		return;
	}

	if(this.path){
		sharedInstance.path2doc.delete(wrapPathAsKey(this.path));
		sharedInstance.name2docs.get(wrapPathAsKey(getFileNameFromPath_(this.path))).delete(this);
		app.setting.removeRecentDocument(this.path);
	}

	if(newPath){
		sharedInstance.forceCloseFromPath(newPath);
	}

	this.path = newPath;

	if(newPath){
		sharedInstance.path2doc.set(wrapPathAsKey(newPath), this);
		sharedInstance.solveDuplicateName_(this);
		app.setting.addRecentDocument(newPath);
	}
};

Document.prototype.shouldSaveSnap = function(){
	return this.path || this.windows.size > 1 || this.snap;
};

Document.prototype.syncChange = function(changes){
	if(this.windows.size <= 1)
		return;
		
	if(!changes || !changes.length) return;

	var changeStr;

	this.windows.forEach(function(win){
		try {
			if(win !== this.activeWindow){
				var webContents = win.webContents;
				if(!webContents.isDestroyed()) {
					if(!changeStr) {
						changeStr = JSON.stringify(changes);
					}
					webContents.executeJavaScript("File.editor.applyChange(" + changeStr + ")");
				}
			}
		} catch(e) {
			Raven.captureException(e, {extra: {
				changes: changes.map ? changes.map(function(c){
					return c.type
				}) : "unknown"
			}});
		}
	}, this);
};

Document.prototype.addSnap = function(snap){
	if(!this.path && this.windows.size <= 1){
		this.snap = null;
		return;
	}
	this.snap = snap;
};

Document.prototype.enterOversize = function(){
	this.windows.forEach(function(win){
		if(this.activeWindow == win) return;
		win.webContents.executeJavaScript("File.tryEnterOversize('', true, true)");
	});
};

Document.prototype.getSnap = function(){
	return this.snap;
};

Document.prototype.setLastSync = function(timeStamp){
	this.lastSync = timeStamp;
};

Document.prototype.setActiveWindow = function(activeWindow){
	this.activeWindow = activeWindow;
};

Document.prototype.saveFromUntitled = function(newPath) {
	this.windows.forEach(function(win){
		win.webContents.send("saveFromUntitled", newPath);
	});
};

Document.prototype.isSnapValid = function(){
	if(!this.path && this.snap) {
		return true;
	} else if(this.snap && this.lastSync > -1){
		// if the doc is already closed, let's validate the snap.
		try {
			var stats = fsp.statSync(this.path),
				mtime = new Date(util.inspect(stats.mtime)) - 0;

			console.debug("lastSync " + this.lastSync + ", timestamp " + this.snap.timeStamp + ", mtime " + mtime);

			return this.snap.timeStamp - 0 > mtime;
		} catch(e){
			console.warn(e);
		}
		console.debug("snap is not valid ");
		return false;
	}
};

Document.prototype.getWindowToFocus = function(){
	var win = (this.activeWindow || this.windows.keys().next().value);
	if(win){
		if(win.isDestroyed()){
			this.activeWindow = null;
			this.windows.delete(win);
		} else {
			return win;
		}
	}
	return null;
};

Document.prototype.syncFullContent = function(fromSourceMode){
	var contentShouldSync = false;

	this.windows.forEach(function(win){
		if(this.activeWindow == win) return;

		if(!contentShouldSync && (win.inSourceMode && !fromSourceMode || !win.inSourceMode && fromSourceMode)){
			contentShouldSync = true;
		}
	});

	if(!contentShouldSync) return;

	var windows = this.windows;
	this.activeWindow.webContents.executeJavaScript("File.sync(false, true)").then(function(){
		windows.forEach(function(win){
			if(this.activeWindow == win) return;

			if(win.inSourceMode && !fromSourceMode || !win.inSourceMode && fromSourceMode){
				win.webContents.executeJavaScript("File.editor.applyFullContent("
						+ !!fromSourceMode + ")");
			}
		});
	});
	return null;
};

Document.prototype.popBackupState = function(){
	var s = this.backupState;
	this.backupState = undefined;
	return s;
};

var getFileNameFromPath_ = function(path){
	return require("path").basename(path)
};

var isFsCaseInsensitive = fsp.isCaseInsensitive();

function wrapPathAsKey(path){
		if(isFsCaseInsensitive)
				return path ? path.toLowerCase() : path;
		else
				return path;
}

var DocumentController = function(){
	this.documents = new Set(); 
	this.path2doc = new Map(); // path <--> document
	this.win2doc = new Map();
	this.name2docs = new Map(); //expand to full path when filename is duplicate
	this.frozenDocs = [];
};

var lastWinState = null;

DocumentController.prototype.makeWindow_ = function(displayNow){
	function prepWindow(win){
			win.webContents.on("will-navigate", function(event, url){
					event.preventDefault();
					shell.openExternal(url);
			});
			win.webContents.on("new-window", function(event, url){
					event.preventDefault();
					shell.openExternal(url);
			});
			win.webContents.on("crashed", function(event, killed){
					console.error("render process is killed? " + killed);
					console.error(event);
					Raven.captureMessage("render process crashed, killed=" + killed);
			});
	}

	var curWindow = BrowserWindow.getFocusedWindow();
	var config = app.setting.config || {};

	var mainWindowState = windowStateKeeper({
			defaultWidth: config.width,
			defaultHeight: config.height
	});
	var positionState = mainWindowState;

	if(curWindow){
		var posOffset = (curWindow.isMaximized() || curWindow.isFullScreen() ? 0 : 30);
		positionState = {
			x: curWindow.getPosition()[0] + posOffset,
			y: Math.max(0, curWindow.getPosition()[1] - posOffset),
			width: curWindow.getSize()[0],
			height: curWindow.getSize()[1]
		}
	}

	var newWindowOption = {
		'x': positionState.x,
		'y': positionState.y,
		'width':positionState.width,
		'height': positionState.height,
		'minWidth': 400,
		'minHeight': 400,
		'frame': !app.setting.get("framelessWindow"),
		'disableAutoHideCursor': false,
		'backgroundColor': app.setting.get("backgroundColor"),
		'webPreferences': {
			'plugins': false /*true*/, // https://github.com/electron/electron/issues/11722
			'nodeIntegration': true,
			'webviewTag': true,
			'nodeIntegrationInWorker': true,
			'devTools': true,
			'images': config.images,
			'directWrite': config.directWrite,
			'defaultFontFamily' : config.defaultFontFamily,
			'allowDisplayingInsecureContent': true,
			'backgroundThrottling': false
		},
		'autoHideMenuBar': config.autoHideMenuBar,
		'show': displayNow,
		'fullscreen': curWindow && curWindow.isFullScreen()
		},
		pos = (curWindow && curWindow.getPosition()) || lastWinState;
		
	if(isLinux){
			newWindowOption.icon = t_workingDir + '/asserts/icon/icon_256x256.png';
	}

	if (pos && (newWindowOption.x == null || newWindowOption.x == pos.x)) {
			if (pos[0] < 400)
					newWindowOption.x = pos[0] + 30;
			else
					newWindowOption.x = pos[0] - 30;
			newWindowOption.y = pos[1] + 30;
	}
	lastWinState = {
		'x': positionState.x,
		'y': positionState.y,
		'width':positionState.width,
		'height': positionState.height
	};

	var shouldMaximize = !newWindowOption["fullscreen"] && curWindow && curWindow.isMaximized();

	if(shouldMaximize || mainWindowState.isMaximized) {
		newWindowOption['show'] = false;
	}

	var mainWindow = new BrowserWindow(newWindowOption);
	mainWindowState.manage(mainWindow);
	Countly.add_event({key: "newWindow", segmentation: {os: process.platform}});

	if(shouldMaximize || mainWindowState.isMaximized){
		mainWindow.maximize();
		displayNow && mainWindow.show();
	}

	mainWindow.loadURL('file://' + t_workingDir + '/window.html');
	// mainWindow.loadURL('http://typora-app/window.html');
	prepWindow(mainWindow);
	return mainWindow;
};

function execJsForDocument(doc, js){
	doc.windows.forEach(function(win){
		try {
			var webContent = win.webContents;
			if(!webContent.isDestroyed()) {
				webContent.executeJavaScript(js);
			}
		} catch(e) {
			Raven.captureException(e, {
				level: "warning", 
				extra: {
					"js": js
				}
			});
			console.error("Execute js {" + js + "} on every window failed " + e.message);
		}
	});
}

DocumentController.prototype.setContentForWindow = function(content, id) {
	var doc = this.getDocumentFromWindowId(id);
	if((doc.activeWindow || {}).id == id) {
		doc.setContent(content);
	}
};

DocumentController.prototype.solveDuplicateName_ = function(doc){
	var path = doc.path,
		filename = wrapPathAsKey(getFileNameFromPath_(path)),
		docs = this.name2docs.get(filename) || new Set();

	this.name2docs.set(filename, docs);
	if(docs.length > 0){
		docs.forEach(function(doc){
			execJsForDocument(doc, "File.FileInfoPanel.setFileTitle(File.filePath);");
		});
	}
	docs.add(doc);
};

DocumentController.prototype.openFile = function(path, option) {
	option = option || {};

	var doc = this.getDocument(path),
		prepWindow = option.prepWindow,
		displayNow = option.displayNow,
		forceCreateWindow = option.forceCreateWindow,
		win;
	
	if(doc){
		win = doc.getWindowToFocus();
		if(displayNow){
			win && win.focus();
		}
		if(!forceCreateWindow && (!prepWindow || win)){
			return doc;
		}
	} else {
		path = path && require("path").normalize(path);
		doc = this.recallDoc(path) || new Document(path);
		if(path){
			this.path2doc.set(wrapPathAsKey(path), doc);
			this.documents.add(doc);
			this.solveDuplicateName_(doc);
			app.setting.addRecentDocument(path);
		}
	}

	if(prepWindow){
		win = this.makeWindow_(displayNow);
		if(option.slient){
			win.slientOpenFailure = true;
			win.webContents.executeJavaScript("File.option.slientOpenFailure = true", function(){
				win.slientOpenFailure = false;
			});
		}

		this.addWindowToDocument_(doc, win);
		
		if(isLinux && process.argv.length <= 1){
					// TODO: enable this on Windows
					readStdin(win);
			}
	}

	if(displayNow){
		win.focus();
	}

	if(path) {
		Countly.add_event({key: "openFile", segmentation: {os: process.platform}});
	} else {
		Countly.add_event({key: "newFile", segmentation: {os: process.platform}});
	}

	return doc;
};

DocumentController.prototype.addWindowToDocument_ = function(doc, win) {
	this.win2doc.set(win.id, doc);
	doc.activeWindow = win;
	doc.windows.add(win);
	app.addBackup({
		id: win.id,
		path: doc.path
	});
};

DocumentController.prototype.getDocument = function(path) {
	if(path){
		path = wrapPathAsKey(require("path").normalize(path));
		return this.path2doc.get(path);
	}
	return null;
};

DocumentController.prototype.getDocumentFromWindowId = function(windowId) {
	var doc = this.win2doc.get(windowId);
	if(doc && doc.activeWindow && doc.activeWindow.isDestroyed()) {
		doc.setActiveWindow(BrowserWindow.fromId(windowId));
	}
	return doc;
};

DocumentController.prototype.removeWindow = function(windowId) {
	var doc = this.getDocumentFromWindowId(windowId),
		curWindow = BrowserWindow.fromId(windowId);

	if(doc){
		if(doc.activeWindow == curWindow){
			doc.activeWindow = null;
		}
		doc.windows.delete(curWindow);
		if(doc.windows.size == 0){
			app.removeBackup(windowId);
			this.removeDocument(doc);
		}
		this.win2doc.delete(windowId);
	}

	Countly.add_event({key: "closeWindow", segmentation: {os: process.platform}});
};

DocumentController.prototype.frozenDoc = function(doc){
	if(doc.snap && doc.snap.nodeMap && doc.path){
		if(this.frozenDocs.length > 20){
			this.frozenDocs.splice(10, this.frozenDocs.length - 10);
		}
		this.frozenDocs.push(doc);
	}
};

DocumentController.prototype.recallDoc = function(path){
	if(!path) return;

	var cnt = this.frozenDocs.length,
		i = 0,
		oldDoc,
		delIndex = -1;
	for(; i < cnt; i++){
		var doc = this.frozenDocs[i],
			found;

		if(!doc.path) continue;

		if(isFsCaseInsensitive){
			found = doc.path.toLowerCase() == path.toLowerCase();
		} else {
			found = doc.path == path;
		}
		if(found){
			delIndex = i;
			oldDoc = doc;
			break;
		}
	}
	this.frozenDocs.splice(delIndex, 1);
	return oldDoc;
};

DocumentController.prototype.removeDocument = function(doc) {
	this.documents.delete(doc);
	if(doc.path){
		this.path2doc.delete(wrapPathAsKey(doc.path));
		this.name2docs.get(wrapPathAsKey(getFileNameFromPath_(doc.path))).delete(doc);
		doc.activeWindow = null;
		doc.windows = new Set();
		this.frozenDoc(doc);
		Countly.add_event({key: "closeFile", segmentation: {os: process.platform}});
	}
};

DocumentController.prototype.forceCloseFromPath = function(path) {
	if(path){
		var doc = this.getDocument(path);
		if(doc){
			Array.from(doc.windows).forEach(function(win){
				this.removeWindow(win.id);
				win.destroy();
			}, this);
		}
	}
};

DocumentController.prototype.hasDuplicateName = function(filename) {
	if(filename){
		return (this.name2docs.get(wrapPathAsKey(filename)) || []).length > 1;
	}
	return false;
};

DocumentController.prototype.switchDocument = function(winId, newPath) {
	var win = BrowserWindow.fromId(winId),
		oldDoc = this.getDocumentFromWindowId(winId),
		newDoc = this.getDocument(newPath);

	if(oldDoc == newDoc){
		return newDoc;
	}

	if(!newDoc){
		newDoc = this.openFile(newPath);
	}

	this.removeWindow(winId);
	this.addWindowToDocument_(newDoc, win);
	return newDoc;
};

var readStdin = function (mainWindow) {
		var data = [];
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", function(chunk){
				console.log("==read==\n" + chunk);
				data.push(chunk);
		});
		process.stdin.on("end", function(){
				if(data.length){
						try {
								var exec = "File.reloadContent(" + JSON.stringify(data.join("\n")) + ")";
								mainWindow.webContents.executeJavaScript(exec);
						} catch(e){
								console.error(e.message);
						}
				}
		});
};

BrowserWindow.prototype.setInSourceMode = function(inSourceMode){
	this.inSourceMode = inSourceMode;
};


var sharedInstance = new DocumentController();

exports = module.exports = sharedInstance;