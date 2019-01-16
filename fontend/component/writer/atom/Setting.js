var electron = require('electron'),
    app = electron.app,
    util = require('util'),
    Hjson = require('hjson'),
    Menu = electron.Menu,
    MenuItem = electron.MenuItem,
    BrowserWindow = electron.BrowserWindow,
    shell = electron.shell,
    isWin = process.platform == 'win32',
    isMac = process.platform == 'darwin',
    isLinux = process.platform == 'linux',
    fs = require('fs-extra'),
    t_workingDir = require("path").join(__dirname, "../"),
    pkg = require("../package.json"),
    Raven = require('raven'),
    Countly = require('countly-sdk-nodejs');

var isLoggingEnd,
    originOut;

var logStream = (function initLog_() {
    var file_path = app.getPath("userData") + '/typora.log',
        log_file;
        
    require("fs-extra").ensureFileSync(file_path);
    log_file = fs.createWriteStream(file_path, {
        flags: 'a'
    });

    console.log = function(d){
        !isLoggingEnd && log_file.write("INFO " + (new Date()).toLocaleString() + "  " + util.format(d) + "\n");
    };

    console.error = function(d){
        !isLoggingEnd && log_file.write("ERROR " + (new Date()).toLocaleString() + "  " + util.format(d) + "\n");
    };

    console.debug = function(d){
        !isLoggingEnd && log_file.write("DEBUG " + (new Date()).toLocaleString() + "  " + util.format(d) + "\n");
    };

    originOut = process.stdout.write;
    process.stdout.write = process.stderr.write = log_file.write.bind(log_file);

    return log_file;
})();

function prepDatabase(path){
    var lowdb = require('lowdb');
    var FileSync = require('lowdb/adapters/FileSync');

    var adapter = new FileSync(path, {
        serialize: function(obj) {
            str = JSON.stringify(obj) || "{}";
            return (new Buffer(str)).toString("hex");
        },
        deserialize: function(str) {
            try {
                str = (new Buffer(str || "", "hex")).toString();
                return JSON.parse(str);
            } catch (e) {
                return {};
            }
        }
    });
    return lowdb(adapter);
}

var Setting = function(){
    this.db;
    this.history;
    this.allThemes = [];
    this.config;
    this.pandocValid;
    this.logStream = logStream;
    this.saveTimer = null;
    this.downloadingDicts = [];
};

Setting.prototype.closeLogging = function() {
    isLoggingEnd = true;
    process.stdout.write = process.stderr.write = originOut;
    this.logStream && this.logStream.end();
};

Setting.prototype.isPandocValid = function(){
    return this.pandocValid;
};

Setting.prototype.setPandocValid = function(pandocValid){
    this.pandocValid = pandocValid;
};

Setting.prototype.put = function(key, val){
    var state = this.db.getState();
    state[key] = val;
    this.saveTimer && clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(this.save.bind(this), 1000);
};

Setting.prototype.get = function(key, defaultVal) {
    try {
        if (key == 'recentDocument')
            return this.getRecentDocuments();
        else if (key == 'recentFolder')
            return this.getRecentFolders();
        else if (key == 'framelessWindow' && isLinux)
            return false;
        else {
            var state = this.db.getState();
            return state[key] === undefined ? defaultVal : state[key];
        }
    } catch (e) {
        console.error(e);
        return defaultVal;
    }
};

Setting.prototype.save = function(){
    this.saveTimer && clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
        this.db.write(console.eror(e.stack));
    } catch(e){}
};

Setting.prototype.syncAll = function(){
    this.saveTimer && clearTimeout(this.saveTimer);
    try {
        this.db.write();
        this.history.write();
    } catch(e){console.eror(e.stack)}
};

Setting.prototype.getCurrentTheme = function(){
    return this.get("theme") || "github.css";
};

Setting.prototype.getAllThemes = function(){
    return this.allThemes;
};

Setting.prototype.getRecentFolders = function(){
    var state = this.history.getState();
    var recentFolders = state['recentFolder'];
    if(!recentFolders){
        recentFolders = [];
        state['recentFolder'] = recentFolders;
    }
    return recentFolders || [];
};

Setting.prototype.addRecentFolder = function(path){
    console.log("addRecentFolder");
    path = require("path").normalize(path);

    var fileName = require("path").basename(path),
        recentFolders = this.getRecentFolders(),
        size;

    if(!fileName.length) return;
    
    this.removeRecentFolder(path, true);
    recentFolders.unshift({
        name: fileName,
        path: path,
        date: new Date()
    });

    size = recentFolders.length;
    size > 8 && recentFolders.splice(8);

    app.addRecentDocument(path);
    try {
        this.history.write();
    } catch(e){}
    app.refreshMenu();
};

Setting.prototype.removeRecentFolder = function(path){
    var state = this.history.getState();
    var recentFolders = state['recentFolder'],
        index = recentFolders.findIndex(function(item){
            return item.path == path;
        });
    if (~index){
        recentFolders.splice(index, 1);
        try {
            this.history.write();
        } catch(e){}
        app.refreshMenu();
    }
};

Setting.prototype.getRecentDocuments = function(){
    var state = this.history.getState();
    var recentDocument = state['recentDocument'];
    if(!recentDocument){
        recentDocument = [];
        state['recentDocument'] = recentDocument;
    }
    return recentDocument || [];
};

Setting.prototype.addRecentDocument = function(path){
    console.log("addRecentDocument");
    var fileName = require("path").basename(path),
        recentDocuments = this.getRecentDocuments(),
        size;
    
    this.removeRecentDocument(path, true);
    recentDocuments.unshift({
        name: fileName,
        path: path,
        date: fileName.length ? (new Date() - 0) : 0
    });

    size = recentDocuments.length;
    size > 40 && recentDocuments.splice(40);

    app.addRecentDocument(require("path").normalize(path));
     try {
        this.history.write();
    } catch(e){}
    app.refreshMenu();
};

Setting.prototype.removeRecentDocument = function(path, changeModelOnly){
    var recentDocuments = this.get('recentDocument'),
        index = recentDocuments.findIndex(function(item){
            return item.path == path;
        });
    if (~index){
        recentDocuments.splice(index, 1);
        if(!changeModelOnly){
             try {
                this.history.write();
            } catch(e){}
            app.refreshMenu();
        }
    }
};

Setting.prototype.clearRecentDocuments = function(){
    console.log("clearRecentDocuments");
    var state = this.history.getState();
    state['recentDocument'] = [];
    state['recentFolder'] = [];
    try {
        this.history.write();
    } catch(e){}
    app.clearRecentDocuments && app.clearRecentDocuments();
    app.refreshMenu();
};

Setting.prototype.compareVersion = function(a, b) {
    var i, l, d;
    a = a.split('.');
    b = b.split('.');
    l = Math.min(a.length, b.length);

    for (i=0; i<l; i++) {
        d = parseInt(a[i], 10) - parseInt(b[i], 10);
        if (d !== 0) {
            return d;
        }
    }
    return a.length - b.length;
};

Setting.prototype.refreshThemeMenu = function(){
    if(Menu.getApplicationMenu().getItem("Themes") == null){
        return;
    }

    var menus = Menu.getApplicationMenu().getItem("Themes").submenu,
        currentTheme = this.getCurrentTheme();

    menus.clear();

    this.allThemes.map(function(themeCss){
        var themeName = themeCss.replace(/\.css$/, "").replace(/(^|-|_)(\w)/g, function(letter, f, p1, index) {
            return (f ? " ": "") + p1.toUpperCase();
        });

        menus.append(new MenuItem({
            label: themeName, 
            type: 'checkbox', 
            checked: themeCss == currentTheme,
            click: function(){
                app.forceRefreshMenu();
                
                BrowserWindow.getAllWindows().map(function(curWindow) {
                    curWindow.webContents.executeJavaScript("ClientCommand.setTheme('" + themeCss + "', '" + themeName + "');");
                });
            }
        }));
    });

    if(isMac){
        Menu.setApplicationMenu(Menu.getApplicationMenu());
    }
};

var generateUUID = function(){
    var d = new Date().getTime();
    return uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
        .replace(/[xy]/g, function(c) {
        var r = (d + Math.random()*16)%16 | 0;
        d = Math.floor(d/16);
        return (c=='x' ? r : (r&0x3|0x8)).toString(16);
    });
};

Setting.prototype.generateUUID = function(){
    var uuid = this.get("uuid", undefined);
    if(!uuid){
        uuid = generateUUID();
        this.put("uuid", uuid);
    }
    return uuid;
};

var instanceKey;

var encodeSensitiveData = function(str){
    return str && str
    .replace(/([^\\\/\s]+[\\\/]){3,}[^\s'"]+['"]*/g, "{filepath}")
    .replace(/[^\s."'{]+\.(md|mmd|markdown|txt|text)/g, "{filepath}");
};

var processJsFile = function(filePath){
    var l = -1;
    filePath = filePath.replace(/\\/g, "/");
    l = filePath.lastIndexOf("/atom");
    
    if(l > -1) {
        filePath = "http://typora-app/atom/" +
            filePath.substring(l)
            .replace(/^\/atom(\.asar)?\//, '');
    }
    return filePath;
};

var sanitizeData = function(data){
    if(!data) return;
    if(data.message) {
        data.message = encodeSensitiveData(data.message);
    }
    (data.exception || []).forEach(function(e){
        if(e.value) {
            e.value =  encodeSensitiveData(e.value);
        }
        if(e.stacktrace && e.stacktrace.frames) {
            e.stacktrace.frames.forEach(function(f){
                if(f.filename) {
                    f.filename = processJsFile(f.filename);
                }
            });
        }
    });
    var frames = data.stacktrace || [];
    ((data.exception || {}).values || []).forEach(function(v, i){
        if(!v) return;
        if(v.value) {
            v.value = encodeSensitiveData(v.value);
        }
        if(v.stacktrace && v.stacktrace.frames) {
            frames = frames.concat(v.stacktrace.frames);
        }
    });
    if(frames.length) {
        frames.forEach(function(f){
            var l = -1;
            l = f.filename.lastIndexOf("atom.asar");

            
            if(l > -1) {
                f.filename = "http://typora-app/atom/" +            f.filename.substring(l + 9)
                .replace(/\\/g, "/");
            }
        });
    }
};

var initCountly = function(setting, extra, queue){
    console.debug("initCountly");
    var sendUsageInfo = (setting.get("send_usage_info") + '') != 'false';

    Countly.init({
        app_key: "3162bc659f38963b8f15099e19551533c80bb5a0",
        url: sendUsageInfo ? "https://count.typora.io" : "",
        interval: 10 * 1000,
        fail_timeout: 30,
        app_version: app.getVersion(),
        device_id: extra.userId,
        storage_path: app.getPath("userData"),
        force_post: true
    });
    Countly.begin_session(true);
    queue.forEach(function(event){
        event && Countly.add_event(event);
    });
};

var initSentry = function(setting){
    console.debug("initSentry");

    Raven.config('https://d0d9715b99a0479dbe56658b193c1f5a@sentry.typora.io/2', 
    {
        logger: "node",
        release: pkg.releaseId,
        autoBreadcrumbs: {http: false, console: false},
        shouldSendCallback: function(){
            console.debug("shouldSendCallback");
            return setting.db && (setting.get("send_usage_info") + '') != 'false';
        }
    }).install(uncaughtExceptionHandler);
    
    instanceKey = generateUUID();
    Raven.mergeContext({
        tags: {
            instance: instanceKey,
            arch: process.platform,
            appVersion: app.getVersion()
        }
    });
    Raven.disableConsoleAlerts();

    Raven.setDataCallback(function(data){
        try {
            if(!data) return;
            if(data.request) {
                data.request.url = "http://typora/";
            }
            if(data.mechanism) {
                delete data.mechanism;
            }
            if(data.exception) {
                sanitizeData(data);
            }
            return data;
        } catch(e){
            console.error(e.stack);
        }
        return {};
    });
};

Setting.prototype.init = function(){
    initSentry(this);

    this.db = prepDatabase(app.getPath("userData") + "/profile.data");
    this.history = prepDatabase(app.getPath("userData") + "/history.data");

    var lastVersion = this.get("initialize_ver"),
        themeTargetDir = app.getPath("userData") + (isWin ? "\\" : "/") + "themes";

    this.put("initialize_ver", app.getVersion());

    if(!lastVersion && isWin){
        this.put("line_ending_crlf", true);
    }

    var userId = this.generateUUID();
    Raven.mergeContext({
        user: {
            id: userId
        }
    });

    var self = this,
        allThemes = self.allThemes,
        currentTheme = this.getCurrentTheme(),
        EmptyFunction = function(){},
        pathNode = require("path"),
        fsp = require("fs-plus");

    function initThemes(){
        fsp.list(themeTargetDir, function (err, files) {
            (files || []).forEach(function (file) {
                var themeCss = pathNode.basename(file);
                if(/^[^A-Z\\/]+\.css$/.exec(themeCss) && !/\.user\.css/.exec(themeCss)){
                    allThemes.push(themeCss);
                }
            });
            console.debug(self.allThemes);
            try {
                self.refreshThemeMenu();
            } catch(e) {
                Raven.captureException(e);
            }
        });
    }

    var luanchFromDiffVersion = 0;
    if(!lastVersion) {
        luanchFromDiffVersion = 1;
    } else {
        luanchFromDiffVersion = this.compareVersion(app.getVersion(), lastVersion);
    }
    
    if(luanchFromDiffVersion != 0){
        console.log("luanchFromDiffVersion, pre version is " + lastVersion);
    }

    var themeSourceDir = t_workingDir + "/style/themes";
    var backupFolder = themeTargetDir + "/old-themes";

    function overwriteThemeFolder() {
        console.log("overwriteThemeFolder");

        fs.ensureDirSync(backupFolder);
        
        var skipBackups = [];

        // quick prepare current theme
        if(["github.css", "newsprint.css", "night.css", "pixyll.css", "white.css"].indexOf(currentTheme) > -1){
            try {
                fs.renameSync(pathNode.join(themeTargetDir, currentTheme), 
                    pathNode.join(backupFolder, currentTheme));
                skipBackups.push(currentTheme);
            } catch(e){}

            fs.copySync(pathNode.join(themeSourceDir, currentTheme), 
                    pathNode.join(themeTargetDir, currentTheme), {overwrite: true});
        }

        fsp.list(themeSourceDir, function (err, files) {
            Promise.all(files.map(function (file) {
                var name = pathNode.basename(file);
                return new Promise(function(resolve, reject){
                    if(skipBackups.indexOf(name) > -1){
                        return resolve();
                    }

                    var src = pathNode.join(themeSourceDir, name),
                        target = pathNode.join(themeTargetDir, name),
                        backup = pathNode.join(backupFolder, name);

                    fs.rename(target, backup, function(){
                        fs.copy(src, target, function(){
                            resolve();
                        });
                    });
                });
            })).then(function(){
                initThemes();
            });
        });
    }

    if(luanchFromDiffVersion != 0 || !fs.existsSync(themeTargetDir)){
        overwriteThemeFolder();
    } else {
        initThemes();
    }

    if(luanchFromDiffVersion != 0) {
        var forceCopyOpt = {
            overwrite: true
        };

        fs.copy(t_workingDir + "/conf.default.json", app.getPath("userData") + "/conf/conf.default.json", forceCopyOpt, EmptyFunction);

        var userConfigPath = app.getPath("userData") + "/conf/conf.user.json";
        fs.exists(userConfigPath, function(exists){
            if(!exists || lastVersion == "0.9.5"){
                fs.copy(t_workingDir + "/conf.default.json", userConfigPath, forceCopyOpt, EmptyFunction);
            }
        });

        if(!lastVersion){
            this.put("strict_mode", true);
            this.put("copy_markdown_by_default", true);
        } else if(this.compareVersion(lastVersion, "0.9.51") <= 0){
            if(this.get("enable_inline_math") == null){
                this.put("enable_inline_math", true);
            }
        } else if(this.compareVersion(lastVersion, "0.9.58") <= 0){
            if(this.get("no_spell_check")){
                this.put("preset_spell_check", "disabled");
            }
        }
    }

    this.initUserConfig_();
    this.initDictionary_();

    if(this.config.flags && this.config.flags.length){
        try {
            this.config.flags.forEach(function(f){
                if(!f.length) return;
                console.log("--" + f.join(" "));
                app.commandLine.appendSwitch.apply(null, f);
            });
        } catch(e){
            console.error(e.stack);
        }
    }

    initCountly(this, {
        userId: userId
    }, [{
        key: "launch",
        segmentation: {
            os: process.platform,
            theme: currentTheme,
            windowStyle: this.get("framelessWindow") ? "frameless": "system"
        }
    }, (lastVersion && luanchFromDiffVersion != 0) ? {
        key: luanchFromDiffVersion > 0 ? "upgradeApp" : "downgradeApp",
        segmentation: {
            change: lastVersion + " → " + app.getVersion(),
            os: process.platform
        }
    } : {
        key: "newInstall",
        segmentation: {os: process.platform}
    }]);
};

Setting.prototype.initUserConfig_ = function(){
    var confPath = app.getPath("userData") + "/conf/conf.user.json",
        conf;
    try {
        conf = fs.readFileSync(confPath, 'utf8');
        if(conf){
            this.config = Hjson.parse(conf);
        } else {
            this.config = {};
        }
    } catch(e){
        console.log("cannot parse user config, use the default one");
        this.config = {};
    }
    this.setDefaultFonts_();
};

Setting.prototype.setDefaultFonts_ = function(){
    var l = this.getUserLocale();
    if(l == "zh-Hans"){
        this.config.defaultFontFamily = this.config.defaultFontFamily || {};
        if(isWin){
            this.config.defaultFontFamily.standard = this.config.defaultFontFamily.standard || "微软雅黑";
            this.config.defaultFontFamily.standard = this.config.defaultFontFamily.sansSerif || "微软雅黑";
        } else if(isLinux){
            this.config.defaultFontFamily.standard = this.config.defaultFontFamily.standard || "Noto Serif CJK SC";
            this.config.defaultFontFamily.standard = this.config.defaultFontFamily.sansSerif || "Noto Sans CJK SC";
            this.config.defaultFontFamily.standard = this.config.defaultFontFamily.serif || "Noto Serif CJK SC";
        }
    }
};

var userLanguageSetting;

Setting.prototype.getUserLocale = function(){
    if(!userLanguageSetting){
        userLanguageSetting = this.get("userLanguage", "auto");
    }
    if(userLanguageSetting == "auto"){
        userLanguageSetting = app.getLocale();
    } 

    //quick refer: https://github.com/electron/electron/blob/master/docs/api/locales.md
    switch(userLanguageSetting){
        case "zh-CN":
        case "zh-Hans":
           userLanguageSetting =  "zh-Hans";
           break;
        case "zh-TW":
        case "zh-Hant":
           userLanguageSetting =  "zh-Hant";
           break;
        case "it":
        case "it-IT":
        case "it-CH":
           userLanguageSetting =  "it-IT";
           break;
        case "nl":
        case "nl-NL":
            userLanguageSetting =  "nl-NL";
            break;
        case "hu":
        case "hu-HU":
            userLanguageSetting =  "hu-HU";
            break;
        case "pl":
        case "pl-PL":
            userLanguageSetting =  "pl-PL";
            break;
        case "pt":
        case "pt-BR":
        case "pt-PT":
            userLanguageSetting =  "pt-BR";
            break;
        case "ko":
        case "ko-KR":
            userLanguageSetting =  "ko-KR";
            break;
        case "es-ES":
        case "es":
        case "es-419":
            userLanguageSetting =  "es-ES";
            break;
        case "el":
        case "el-CY":
        case "el-GR":
            userLanguageSetting =  "el-GR";
            break;
        case "fr":
        case "fr-FR":
        case "fr-CH":
        case "fr-CA":
            userLanguageSetting =  "fr-FR";
            break;
        case "hr":
        case "hr-HR":
            userLanguageSetting =  "hr-HR";
            break;
        case "sv":
        case "sv-SE":
            userLanguageSetting =  "sv-SE";
            break;
        case "de":
        case "de-AT":
        case "de-CH":
        case "de-DE":
            userLanguageSetting =  "de-DE";
            break;
        case "ru":
        case "ru-RU":
            userLanguageSetting =  "ru-RU";
            break;
        case "ja":
        case "ja-JP":
            userLanguageSetting =  "ja-JP";
            break;
        case "cs":
        case "cs-CZ":
            userLanguageSetting = "cs-CZ";
            break;
        default:
            userLanguageSetting = "Base";
    }
    return userLanguageSetting;
};

Setting.prototype.getLocaleFolder = function(pkg){
    pkg = pkg || "Front";
    return "locales/" + this.getUserLocale() + ".lproj/" + pkg + ".json";
};

app.setting = new Setting();

var ipc = require('electron').ipcMain;
ipc.on('errorInWindow', function(event, error){
    console.error("[RenderProcess " + event.sender.id + "][Error] " + error);
});

ipc.on('sendLog', function(event, log){
    console.log("[RenderProcess " + event.sender.id + "][Log] " + log);
});

ipc.on('sendError', function(event, log){
    console.error("[RenderProcess " + event.sender.id + "][Error] " + log);
});

var uncaughtExceptionHandler = function(error, sendErr, eventId) {
    if(sendErr) {
        console.info(sendErr.stack || sendErr.message);
    }
    console.error(error.stack || error.message);
    if(!app.isReady()) return;
    dialog = require('electron').dialog;
    stack = (ref = error.stack) != null ? ref : error.name + ': ' + error.message;
    message = 'Uncaught Exception:\n' + stack;
    dialog.showMessageBox(null, {
      type: "error",
      buttons: ["OK", "Learn Data Recovery"],
      title: 'A JavaScript error occurred in the main process',
      message: message
    }, function(btnIndex){
      if(btnIndex == 1){
          shell.openExternal("http://support.typora.io/Version-Control/");
      } else {
        process.exit(1);
      }
    });
  };

// process.on('uncaughtException', uncaughtExceptionHandler);

process.on('unhandledRejection', function(error) {
    if(error && error.errno == "ENOTFOUND") {
        return;
    }
    Raven.captureException(error, {level: "debug", 
        tags: {
            category: "unhandledRejection"
        }
    });
    console.error('unhandledRejection ' + error.stack);
});

Setting.prototype.getUserDictionaryPath = function(){
    return this.userDictionaryPath;
};

function sendToRender(channel, data) {
    BrowserWindow.getAllWindows().forEach(function(win){
        var webContents = win.webContents;
        if(!webContents.isDestroyed() && !webContents.isLoading()) {
            webContents.send(channel, data);
        }
    });
}

Setting.prototype.getDownloadingDicts = function(){
    return this.downloadingDicts;
};

function removeFromArr(arr, obj) {
    var index = arr.indexOf(obj);
    if (index > -1) {
        arr.splice(index, 1);
    }
}

Setting.prototype.downloadDict = function(locale, winId){
    var download = require('electron-dl').download;
    var win = BrowserWindow.fromId(winId);
    var HOST = "https://typora-download.nyc3.cdn.digitaloceanspaces.com/dictionaries/";
    sendToRender("dict-download-start", locale);
    var userDictionaryPath = this.userDictionaryPath;
    var downloadingDicts = this.downloadingDicts;

    if(downloadingDicts.indexOf(locale) > -1) return;

    var onDownloadError = function(locale, e){
        sendToRender("dict-download-err", {
            locale: locale,
            message: e.message
        });
        fs.unlink(userDictionaryPath + "/_" + locale + ".dic", function(){});
        fs.unlink(userDictionaryPath + "/_" + locale + ".aff", function(){});
        removeFromArr(downloadingDicts, locale);
    };

    downloadingDicts.push(locale);

    Promise.all(["dic", "aff"].map(function(type){
        return download(win, HOST + locale + "/index." + type, {
            directory: userDictionaryPath,
            filename: "_" + locale + "." + type,
            saveAs: false,
            onCancel: function(){
                onDownloadError(locale, {message: "Dowbload Cancelled"});
            },
            onProgress: function(p){
                try {
                    sendToRender("dict-download-process", {
                        locale: locale,
                        type: type,
                        process: p
                    });
                } catch(e){
                    console.error(e);
                }
            }
        });
    }, this)).then(function(){
        Promise.all([locale + ".dic", locale + ".aff"].map(function(f){
            return fs.move(userDictionaryPath + "/_" + f, userDictionaryPath + "/" + f, { overwrite: true });
        })).then(function(){
            removeFromArr(downloadingDicts, locale);
            sendToRender("dict-download-end", locale);
        }).catch(function(e){
            onDownloadError(locale, e);
        });
    }).catch(function(e){
        onDownloadError(locale, e);
    });

    download(win, HOST + locale + "/LICENSE", {
        directory: this.userDictionaryPath,
        filename: locale + "-LICENSE",
        saveAs: false,
        showBadge: false
    });
};

var getDictionaryPath_ = function(){
    var path = require("path");
    var dict = path.join(t_workingDir, "node_modules", "spellchecker", "vendor", "hunspell_dictionaries");
    try {
        // HACK: Special case being in an asar archive
        var unpacked = dict.replace(
            ".asar" + path.sep,
            ".asar.unpacked" + path.sep
        );
        if (require("fs").statSyncNoException(unpacked)) {
            dict = unpacked;
        }
    } catch (error) {}
    return dict;
};

Setting.prototype.initDictionary_ = function(){
    var self = this;
    this.userDictionaryPath = null;
    
    this.userDict = {};
    try {
        var oldDictionaryPath = getDictionaryPath_();

        var userDictionaryPath = require("path").join(app.getPath("appData"), "Typora", "dictionaries");

        if(fs.existsSync(userDictionaryPath)) {
            self.userDictionaryPath = userDictionaryPath;
        } else {
            fs.copy(oldDictionaryPath, userDictionaryPath).then(function() {
                Raven.captureBreadcrumb("copy userDictionaryPath");
                self.userDictionaryPath = userDictionaryPath;
                sendToRender("dict-loaded", userDictionaryPath);
            }).catch(function(err) {
                console.error(err);
                Raven.captureException(err);
            });
        }
    } catch(e) {
        console.error(e);
        Raven.captureException(e);
    }

    try {
        if(self.userDictionaryPath) {
            self.userDict = require(this.userDictionaryPath + "/user-dict.json");
        }
    } catch(e){}

    var saveUserDict = function(){
        if(self.userDictionaryPath) {
          require("fs").writeFile(self.userDictionaryPath + "/user-dict.json", 
            JSON.stringify(self.userDict), function(){});
        }

        app.sendEvent("user-dict-update", self.userDict);
    };

    var ipc = electron.ipcMain;
    ipc.on("user-dict-add", function(event, data){
        self.userDict[data.lang] = self.userDict[data.lang] || [];
        self.userDict[data.lang].push(data.word);
        saveUserDict();
    });
    ipc.on("user-dict-remove", function(event, data){
        self.userDict[data.lang] = (self.userDict[data.lang] || []).filter(function(ext){return ext != data.word});
        saveUserDict();
    });
};

Setting.prototype.buildOption = function(){
    var option = {};

    option.autoToggleEmojiAutoComplete = this.get("trigger_emoji_autocomplete") != false;
    option.enableInlineMath = this.get("enable_inline_math") || false;
    option.enableHighlight = this.get("enable_highlight") || false;
    option.enableSubscript = this.get("enable_subscript") || false;
    option.enableSuperscript = this.get("enable_superscript") || false;
    option.enableDiagram = this.get("enable_diagram") != false;

    option.copyMarkdownByDefault = this.get("copy_markdown_by_default") || false;
    option.showLineNumbersForFence = this.get("show_line_numbers_for_fence") || false;
    option.noPairingMatch = this.get("no_pairing_match") || false;
    option.autoPairExtendSymbol = this.get("match_pari_markdown") || false;
    option.expandSimpleBlock = this.get("auto_expand_block") || false;
    option.headingStyle = this.get("heading_style") || 0;
    option.ulStyle = this.get("ul_style") || 0;
    option.olStyle = this.get("ol_style") || 0;
    option.scrollWithCursor = !this.get("no_mid_caret");
    option.autoNumberingForMath = this.get("auto_numbering_for_math");

    option.useRelativePathForImg = this.get("use_relative_path_for_img") || false;
    option.allowImageUpload = this.get("allow_image_upload") || false;
    option.defaultImageStorage = this.get("image_save_location") || null;
    if(option.defaultImageStorage == "custom") {
        option.defaultImageStorage = this.get("custom_image_save_location");
    }

    option.applyImageMoveForWeb = this.get("apply_image_move_for_web") || false;
    option.applyImageMoveForLocal = !(this.get("no_image_move_for_local") || false);

    option.preferCRLF = this.get("line_ending_crlf") || false;
    option.sidebarTab = this.get("sidebar_tab") || "";
    option.useTreeStyle = this.get("useTreeStyle") || false;
    option.sortType = this.get("file_sort_type") || 0;
    option.strictMarkdown = this.get("strict_mode") || false;
    option.noLineWrapping = this.get("no_line_wrapping") || false;
    option.prettyIndent = this.get("prettyIndent") || false;

    option.convertSmartOnRender = this.get("SmartyPantsOnRendering");
    option.smartDash = this.get("smartDash");
    option.smartQuote = this.get("smartQuote");
    option.remapUnicodePunctuation = this.get("remapPunctuation");

    option.indentSize = this.get("indentSize") || 2;
    option.codeIndentSize = this.get("codeIndentSize") || 4;
    option.enableAutoSave = this.get("enableAutoSave") || false;
    option.saveFileOnSwitch = this.get("save_file_on_switch") || false;
    
    option.presetSpellCheck = this.get("preset_spell_check") || "auto";
    option.autoCorrectMisspell = /*this.get("auto_correct_misspell") ||*/ false;

    var config = this.config || {};
    option.monocolorEmoji = config.monocolorEmoji;

    // start from here
    option.userQuotesArray = this.get("userQuotesArray");
    option.passiveEvents = true;

    option.useCustomFontSize = this.get("useCustomFontSize");
    option.customFontSize = this.get("customFontSize");

    option.canCollapseOutlinePanel = this.get("can_collapse_outline_panel");

    option.preLinebreakOnExport = this.get("preLinebreakOnExport");
    option.preLinebreakOnExport = option.preLinebreakOnExport == true || option.preLinebreakOnExport == "true";

    option.indentFirstLine = this.get("indentFirstLine");

    option.hideBrAndLineBreak = this.get("hideBrAndLineBreak");

    option.isFocusMode = this.get("isFocusMode");
    option.isTypeWriterMode = this.get("isTypeWriterMode");
    option.ignoreLineBreak = this.get("ignoreLineBreak") || false;

    option.sendAnonymousUsage = this.get("send_usage_info");
    if(option.sendAnonymousUsage === undefined || option.sendAnonymousUsage === null) {
        option.sendAnonymousUsage = true;
    }
    option.uuid = this.get("uuid");
    option.appVersion = app.getVersion();
    option.instance = instanceKey;

    option.userLocale = this.getUserLocale();

    option.sidebarWidth = this.get("sidebar-width");

    return option;
};

exports = module.exports = Setting;