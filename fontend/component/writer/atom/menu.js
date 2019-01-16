var electron = require('electron'),
    app = electron.app,
    dialog = electron.dialog,
    Menu = electron.Menu,
    MenuItem = electron.MenuItem,
    BrowserWindow = electron.BrowserWindow,
    ipc = electron.ipcMain,
    fs = require('fs-extra'),
    isWin = process.platform == 'win32',
    isMac = process.platform == 'darwin',
    isLinux = process.platform == 'linux',
    t_workingDir = require("path").join(__dirname, "../");

ipc.on('execForAll', function (event, arg) {
    execForAll(arg);
});

ipc.on('forceRefreshMenu', function (event, arg) {
    app.forceRefreshMenu();
});

var menuDict;

var initMenuDict = function () {
    var lang = app.setting.getUserLocale();
    var dictPath = require("path").join(t_workingDir, app.setting.getLocaleFolder("Menu"));

    console.debug(dictPath);

    try {
        var dict = fs.readFileSync(dictPath, 'utf8');
        if (dict) {
            menuDict = JSON.parse(dict);
        } else {
            menuDict = {};
        }
    } catch (e) {
        console.warn("cannot load dict as " + lang);
        menuDict = {};
    }
};

var refreshMenu = function () {
    updateRecentFilesInMenu(Menu.getApplicationMenu());
};

var execForAll = function (cmd) {
    var exec = "window.File && (" + cmd.toString() + ")();";
    BrowserWindow.getAllWindows().map(function (curWindow) {
        curWindow.webContents.executeJavaScript(exec);
    });
    console.log(exec);
};

var performClientCommand = function (cmd, isFunc) {
    var curWindow = BrowserWindow.getFocusedWindow();
    if (!curWindow) return;
    if (isFunc) {
        curWindow.webContents.executeJavaScript("window.File && !File.blockUI && (" + cmd.toString() + ")();");
    } else {
        curWindow.webContents.executeJavaScript("!File.blockUI && window.ClientCommand['" + cmd + "']();");
    }
};

var getClientCommand = function (selector, isFunc) {
    return function () {
        performClientCommand(selector, isFunc);
    }
};

function getLocalizedLabel(label, forDisplay) {
    var hasAlt = /&[a-z]/i.exec(label),
        hasEllipsis = /(\.\.\.)|(…)/.exec(label);

    label = label.replace(/(\.\.\.)|(…)|&/g, '');

    var localizeLabel = menuDict[label] || label;
    if (hasAlt) {
        return putAccelerator(label, localizeLabel) + (hasEllipsis ? "…" : "");
    } else {
        return localizeLabel + (hasEllipsis ? "…" : "");
    }
}

function getIngoreCase(obj, key) {
    if (!key) return undefined;

    if (!obj._useLowerCase) {
        for (var k in obj) {
            obj[k.toLowerCase()] = obj[k];
        }
    }
    return obj[key.toLowerCase()];
}

var MenuItemsWithAccelerator = {
    'File': 'F',
    'Edit': 'E',
    'Paragraph': 'P',
    'Format': 'O',
    'View': 'V',
    'Themes': 'T',
    'Help': 'H'
};

function putAccelerator(label, localizeLabel) {
    var w = MenuItemsWithAccelerator[label];
    if (!w) return localizeLabel;

    if (isWin || isLinux) {
        var index = localizeLabel.indexOf(w);
        if (index == -1) {
            index = localizeLabel.indexOf(w.toLowerCase());
        } else {
            var index2 = localizeLabel.indexOf(w.toLowerCase());
            if (index2 > -1) {
                index = Math.min(index, index2);
            }
        }
        if (index > -1) {
            localizeLabel = localizeLabel.substr(0, index) + "&" + localizeLabel.substr(index);
        } else {
            localizeLabel += "(&" + w + ")";
        }
    }
    return localizeLabel;
}

function processMenu(obj) {
    if (!obj || !obj.label) return obj;

    var origin = obj.label;
    obj.label = getLocalizedLabel(obj.label);


    if (!obj.submenu) {
        var keyMap = app.setting.config.keyBinding || {},
            userKeyAccelerator = getIngoreCase(keyMap, (obj.label || "").replace(/[.]/g, ''));

        if (!userKeyAccelerator) {
            userKeyAccelerator = getIngoreCase(keyMap, (origin || "").replace(/[.]/g, ''));
        }

        if (userKeyAccelerator != undefined) {
            obj.accelerator = userKeyAccelerator;
        }
    } else {
        obj.submenu.forEach(processMenu);
    }
    return obj;
}

function updateRecentFilesInMenu(menu) {
    function openRecentFileMenuItemAction(menuItem, browserWindow) {
        var path = menuItem.label;
        if (fs.existsSync(path)) {
            app.openFileOrFolder(path, {curWindow: browserWindow});
        } else {
            dialog.showMessageBox({
                title: getLocalizedLabel("Open Failed"),
                message: getLocalizedLabel("File or folder does not exist."),
                buttons: ["OK"]
            });
            app.setting.removeRecentDocument(path);
        }
    }

    try {
        var recentMenu = menu.getItem("File").submenu.getItem("Open Recent").submenu,
            recentFiles = app.setting.getRecentDocuments(),
            recentFolders = app.setting.getRecentFolders();

        recentFiles.sort(function (a, b) {
            return b.date - a.date
        });
        recentFolders.sort(function (a, b) {
            return b.date - a.date
        });

        recentMenu.clear();
        recentMenu.append(new MenuItem({
            label: getLocalizedLabel("Reopen Closed File"),
            accelerator: "CmdOrCtrl+Shift+T",
            click: function () {
                app.reopenClosed();
            }
        }));
        recentMenu.append(new MenuItem({
            type: "separator"
        }));

        if (recentFiles.length) {
            recentFiles.forEach(function (fileObj, i) {
                if (i > 10) return;
                recentMenu.append(new MenuItem({
                    label: fileObj.path,
                    click: openRecentFileMenuItemAction
                }));
            });
            recentMenu.append(new MenuItem({
                type: "separator"
            }));
        }
        if (recentFolders.length) {
            recentFolders.forEach(function (fileObj, i) {
                if (i > 8) return;
                recentMenu.append(new MenuItem({
                    label: fileObj.path,
                    click: openRecentFileMenuItemAction
                }));
            });
            recentMenu.append(new MenuItem({
                type: "separator"
            }));
        }
        if (recentFiles.length + recentFolders.length) {
            recentMenu.append(new MenuItem(processMenu({
                label: "Clear Items",
                click: function () {
                    app.setting.clearRecentDocuments();
                },
                type: "normal"
            })));
        } else {
            recentMenu.append(new MenuItem(processMenu({
                label: "No Recent Files",
                enabled: false
            })));
        }
        Menu.setApplicationMenu(menu);
    } catch (e) {

    }
}

function bindMainMenu() {
    function reopenWithEncodingMenuItemAction(menuItem, browserWindow) {
        var encode = (/\((.+)\)/.exec(menuItem.label) || [])[1] || menuItem.label;
        if (encode == getLocalizedLabel("Auto")) {
            encode = "";
        }
        performClientCommand("function(){File.reloadWithEncoding('" + encode + "')}", true)
    }

    initMenuDict();

    var smartPantsOnRender = app.setting.get("SmartyPantsOnRendering") || false,
        smartQuote = app.setting.get("smartQuote") || false,
        smartDash = app.setting.get("smartDash") || false;

    var template = [processMenu({
        label: '&File',
        submenu: [{
            label: 'New',
            accelerator: 'CmdOrCtrl+N',
            click: getClientCommand("newFile")
        }, {
            label: 'New Window',
            accelerator: 'CmdOrCtrl+Shift+N',
            click: getClientCommand("newWindow")
        }, {
            type: 'separator'
        }, {
            label: 'Open…',
            accelerator: 'CmdOrCtrl+O',
            click: getClientCommand("open")
        }, {
            label: 'Open Folder…',
            click: getClientCommand("openFolder")
        }, {
            type: 'separator'
        }, {
            label: 'Open Quickly…',
            accelerator: 'CmdOrCtrl+P',
            click: getClientCommand("quickOpen")
        }, {
            label: 'Open Recent',
            submenu: []
        }, {
            label: 'Reopen with Encoding',
            submenu: [{
                label: "Auto",
                click: reopenWithEncodingMenuItemAction
            }, {
                type: 'separator'
            }, {
                label: "UTF-8",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "UTF-16 LE",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "UTF-16 BE",
                click: reopenWithEncodingMenuItemAction
            }, {
                type: 'separator'
            }, {
                label: "Western (windows-1252)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Cyrillic (windows-1251)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Cyrillic (ISO-8859-2)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Cyrillic (IBM866)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Cyrillic (IBM855)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Cyrillic (KOI8-R)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Cyrillic (MacCyrillic)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Central European (windows-1250)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Central European (ISO-8859-2)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Geek (windows-1253)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Geek (ISO-8859-7)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Hebrew (windows-1255)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Hebrew (ISO-8859-8)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Chinese Simplified (GB2312)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Chinese Simplified (GB18030)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Chinese Traditional (Big5)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Japanese (SHIFT_JIS)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Japanese (EUC-JP)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Korean (EUC-KR)",
                click: reopenWithEncodingMenuItemAction
            }, {
                label: "Thai (TIS-620)",
                click: reopenWithEncodingMenuItemAction
            }]
        }, {
            type: 'separator'
        }, {
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            click: getClientCommand("save")
        }, {
            label: 'Save As…',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: getClientCommand("saveAs")
        }, {
            label: 'Save All…',
            click: getClientCommand("saveAll")
        }, {
            type: 'separator'
        }, {
            label: 'Open File Location…',
            click: getClientCommand("openFileLocation")
        }, {
            label: 'Reveal in Sidebar',
            click: getClientCommand(function () {
                window.File.editor.library.revealInSidebar();
            }, true)
        }, isLinux ? null : {
            label: 'Properties…',
            click: function (menuItem, browserWindow) {
                browserWindow.webContents.executeJavaScript('reqnode("win-shell").openProperties(File.filePath);');
            }
        }, {
            type: 'separator'
        }, {
            label: 'Import…',
            click: getClientCommand("import")
        }, {
            label: 'Export',
            submenu: [{
                label: 'PDF',
                click: getClientCommand("exportPDF")
            }, {
                label: 'HTML',
                click: getClientCommand("exportHTML")
            }, {
                label: 'HTML (without styles)',
                click: getClientCommand("exportHTMLPlain")
            }, {
                type: 'separator'
            }, {
                label: 'Word (.docx)',
                click: getClientCommand("exportDocx")
            }, {
                label: 'OpenOffice',
                click: getClientCommand("exportOdt")
            }, {
                label: 'RTF',
                click: getClientCommand("exportRTF")
            }, {
                label: 'Epub',
                click: getClientCommand("exportEpub")
            }, {
                label: 'LaTeX',
                click: getClientCommand("exportLaTeX")
            }, {
                label: 'Media Wiki',
                click: getClientCommand("exportWiki")
            }, {
                label: 'reStructuredText',
                click: getClientCommand("exportRST")
            }, {
                label: 'Textile',
                click: getClientCommand("exportTextile")
            }, {
                label: 'OPML',
                click: getClientCommand("exportOPML")
            }, {
                type: 'separator'
            }, {
                label: 'Image',
                click: getClientCommand("exportImage")
            }]
        }, {
            label: 'Print…',
            click: getClientCommand("print")
        }, {
            type: 'separator'
        }, {
            label: 'Preferences…',
            accelerator: 'CmdOrCtrl+,',
            click: getClientCommand("showPreferencePanel")
        }, {
            type: 'separator'
        }, {
            label: 'Close',
            accelerator: 'CmdOrCtrl+W',
            click: getClientCommand("close")
        }]
    }), processMenu({
        label: '&Edit',
        id: 'edit',
        submenu: [{
            label: 'Undo',
            id: "undo",
            accelerator: 'CmdOrCtrl+Z',
            click: getClientCommand("undo")
        }, {
            label: 'Redo',
            id: "redo",
            accelerator: 'CmdOrCtrl+Y',
            click: getClientCommand("redo")
        }, {
            type: 'separator'
        }, {
            label: 'Cut',
            accelerator: 'CmdOrCtrl+X',
            role: 'cut'
        }, {
            label: 'Copy',
            accelerator: 'CmdOrCtrl+C',
            role: 'copy'
        }, {
            label: 'Paste',
            accelerator: 'CmdOrCtrl+V',
            role: 'paste'
        }, {
            type: 'separator'
        }, {
            label: 'Copy as Markdown',
            accelerator: 'CmdOrCtrl+Shift+C',
            click: getClientCommand("copyAsMarkdown")
        }, {
            label: 'Copy as HTML Code',
            click: getClientCommand("copyAsHTMLSource")
        }, {
            label: 'Paste as Plain Text',
            accelerator: 'CmdOrCtrl+Shift+v',
            click: getClientCommand("pasteAsPlain")
        }, {
            type: 'separator'
        }, {
            label: 'Select All',
            accelerator: 'CmdOrCtrl+A',
            /*role: 'selectAll',*/
            click: getClientCommand("selectAll")
        }, {
            label: 'Select Line/Sentence',
            accelerator: 'CmdOrCtrl+L',
            click: getClientCommand(function () {
                File.editor.selection.selectLine();
            }, true)
        }, {
            label: 'Select Styled Scope',
            accelerator: 'CmdOrCtrl+E',
            click: getClientCommand(function () {
                File.editor.selection.selectPhrase();
            }, true)
        }, {
            label: 'Select Word',
            accelerator: 'CmdOrCtrl+D',
            click: getClientCommand(function () {
                File.editor.selection.selectWord();
            }, true)
        }, {
            type: 'separator'
        }, {
            label: 'Delete',
            click: getClientCommand(function () {
                File.delete();
            }, true)
        }, {
            label: 'Delete Range',
            submenu: [
                {
                    label: 'Delete Word',
                    accelerator: 'Shift+Ctrl+D',
                    click: getClientCommand("deleteWord")
                }, {
                    label: 'Delete Styled Scope',
                    click: getClientCommand("deleteScope")
                }, {
                    label: 'Delete Line/Sentence',
                    click: getClientCommand("deleteLine")
                }, {
                    label: 'Delete Block',
                    click: getClientCommand("deleteBlock")
                }
            ]
        }, {
            type: 'separator'
        }, {
            label: 'Jump to Top',
            accelerator: 'Ctrl+Home',
            click: getClientCommand(function () {
                File.editor.selection.jumpTop();
            }, true)
        }, {
            label: 'Jump to Selection',
            accelerator: 'CmdOrCtrl+j',
            click: getClientCommand(function () {
                File.editor.selection.jumpSelection();
            }, true)
        }, {
            label: 'Jump to Bottom',
            accelerator: 'Ctrl+End',
            click: getClientCommand(function () {
                File.editor.selection.jumpBottom();
            }, true)
        }, {
            label: 'Extend Selection to Top',
            accelerator: 'Ctrl+Shift+Home',
            visible: false,
            click: getClientCommand(function () {
                File.editor.selection.jumpTop(true);
            }, true)
        }, {
            label: 'Extend Selection to Bottom',
            accelerator: 'Ctrl+Shift+End',
            visible: false,
            click: getClientCommand(function () {
                File.editor.selection.jumpBottom(true);
            }, true)
        }, {
            label: 'Extend Selection to Line Start',
            accelerator: 'Shift+Home',
            visible: false,
            click: getClientCommand(function () {
                File.editor.selection.extendToLineEdge(false);
            }, true)
        }, {
            label: 'Extend Selection to Line End',
            accelerator: 'Shift+End',
            visible: false,
            click: getClientCommand(function () {
                File.editor.selection.extendToLineEdge(true);
            }, true)
        }, {
            type: 'separator'
        }, {
            label: 'Math Tools',
            submenu: [{
                label: 'Refresh All Math Expressions',
                click: getClientCommand(function () {
                    File.editor.mathBlock.forceRefresh();
                }, true)
            }]
        }, {
            label: 'Image Tools',
            submenu: [{
                label: 'Insert Local Images…',
                click: getClientCommand(function () {
                    File.editor.imgEdit.insertImagesFromLocalFile();
                }, true),
            }, {
                type: 'separator'
            }, {
                label: "When Insert Local Image",
                submenu: [{
                    label: 'Copy Image File to Folder…',
                    type: 'checkbox',
                    click: getClientCommand(function () {
                        File.editor.imgEdit.toggleCopyToFolder();
                    }, true)
                }]
            }, {
                label: "Use Image Root Path…",
                type: 'checkbox',
                click: getClientCommand(function () {
                    File.editor.imgEdit.toggleUseImageRootPath();
                }, true)
            }, {
                type: 'separator'
            }, {
                label: 'Global Image Settings…',
                click: function (menuItem, browserWindow) {
                    browserWindow.webContents.executeJavaScript("File.megaMenu.highlight('image-setting-group');")
                }
            }]
        }, {
            type: 'separator'
        }, {
            label: 'Smart Punctuation',
            submenu: [{
                label: 'Convert on Input',
                type: 'checkbox',
                click: function (menuItem, browserWindow) {
                    var enable = menuItem.checked;
                    browserWindow.webContents.executeJavaScript("File.megaMenu.setSmartyPantsTiming(" + !enable + ")")
                },
                checked: !smartPantsOnRender
            }, {
                label: 'Convert on Rendering',
                type: 'checkbox',
                click: function (menuItem, browserWindow) {
                    var enable = menuItem.checked;
                    browserWindow.webContents.executeJavaScript("File.megaMenu.setSmartyPantsTiming(" + enable + ")")
                },
                checked: smartPantsOnRender
            }, {
                type: 'separator'
            }, {
                label: 'Smart Quotes',
                type: 'checkbox',
                click: function (menuItem, browserWindow) {
                    var enable = menuItem.checked;
                    browserWindow.webContents.executeJavaScript("File.megaMenu.setSmartQuote(" + enable + ")")
                },
                checked: smartQuote
            }, {
                label: 'Smart Dashes',
                type: 'checkbox',
                click: function (menuItem, browserWindow) {
                    var enable = menuItem.checked;
                    browserWindow.webContents.executeJavaScript("File.megaMenu.setSmartDash(" + enable + ")")
                },
                checked: smartDash
            }, {
                type: 'separator'
            }, {
                label: 'Remap Unicode Punctuation on Parse',
                type: 'checkbox',
                click: function (menuItem, browserWindow) {
                    var enable = menuItem.checked;
                    browserWindow.webContents.executeJavaScript("File.megaMenu.setRemapPunctuation(" + enable + ")")
                },
                checked: app.setting.get("remapPunctuation") || (!smartPantsOnRender && (smartQuote || smartDash)),
                enabled: !(!smartPantsOnRender && (smartQuote || smartDash))
            }, {
                type: 'separator'
            }, {
                label: 'More Options…',
                click: function (menuItem, browserWindow) {
                    browserWindow.webContents.executeJavaScript("File.megaMenu.highlight('smart-punctuation-group');")
                }
            }]
        }, {
            label: 'Line Endings',
            submenu: [{
                label: 'Windows Line Endings (CRLF)',
                type: 'checkbox',
                click: getClientCommand(function () {
                    File.setLineEnding(true, true);
                }, true),
            }, {
                label: "Unix Line Endings (LF)",
                type: 'checkbox',
                click: getClientCommand(function () {
                    File.setLineEnding(false, true);
                }, true)
            }]
        }, {
            label: 'Whitespace and Line Breaks',
            submenu: [{
                label: "Indent first line of paragraphs",
                type: 'checkbox',
                click: getClientCommand(function () {
                    File.setIndentFirstLine(!File.option.indentFirstLine, true, true);
                }, true)
            }, {
                type: 'separator'
            }, {
                label: 'Visible <br/>',
                type: 'checkbox',
                checked: true,
                click: getClientCommand(function () {
                    File.setHideBrAndLineBreak(!File.option.hideBrAndLineBreak, true, true);
                }, true),
            }, {
                label: "Preserve single line break",
                type: 'checkbox',
                click: getClientCommand(function () {
                    File.setIgnoreLineBreak(!File.option.ignoreLineBreak, true, true);
                }, true)
            }, {
                type: 'separator'
            }, {
                label: 'Learn More…',
                click: function () {
                    electron.shell.openExternal("http://support.typora.io/Line-Break/");
                },
            }]
        }, {
            label: 'Spell Check…',
            click: function (menuItem, browserWindow) {
                browserWindow.webContents.executeJavaScript("File.editor.spellChecker && File.editor.spellChecker.show();")
            }
        }, {
            type: 'separator'
        }, {
            label: 'Find and Replace',
            submenu: [{
                label: 'Find…',
                accelerator: 'CmdOrCtrl+f',
                click: getClientCommand(function () {
                    File.editor.searchPanel.showPanel();
                }, true)
            }, {
                label: 'Find Next',
                accelerator: 'F3',
                click: getClientCommand(function () {
                    File.editor.searchPanel.highlightNext();
                }, true)
            }, {
                label: 'Find Previous',
                accelerator: 'Shift+F3',
                click: getClientCommand(function () {
                    File.editor.searchPanel.highlightNext(true);
                }, true)
            }, {
                type: 'separator'
            }, {
                label: 'Replace',
                accelerator: 'Ctrl+h',
                click: getClientCommand(function () {
                    File.editor.searchPanel.showPanel(true);
                }, true)
            }]
        }]
    }), processMenu({
        label: "&Paragraph",
        submenu: [{
            /*TODO: change to toggle headings*/
            label: "Heading 1",
            type: "checkbox",
            accelerator: "Ctrl+1",
            click: getClientCommand(function () {
                File.editor.stylize.changeBlock("header1", undefined, true);
            }, true)
        }, {
            label: "Heading 2",
            type: "checkbox",
            accelerator: "Ctrl+2",
            click: getClientCommand(function () {
                File.editor.stylize.changeBlock("header2", undefined, true);
            }, true)
        }, {
            label: "Heading 3",
            type: "checkbox",
            accelerator: "Ctrl+3",
            click: getClientCommand(function () {
                File.editor.stylize.changeBlock("header3", undefined, true);
            }, true)
        }, {
            label: "Heading 4",
            type: "checkbox",
            accelerator: "Ctrl+4",
            click: getClientCommand(function () {
                File.editor.stylize.changeBlock("header4", undefined, true);
            }, true)
        }, {
            label: "Heading 5",
            type: "checkbox",
            accelerator: "Ctrl+5",
            click: getClientCommand(function () {
                File.editor.stylize.changeBlock("header5", undefined, true);
            }, true)
        }, {
            label: "Heading 6",
            type: "checkbox",
            accelerator: "Ctrl+6",
            visible: false,
            click: getClientCommand(function () {
                debugger;
                File.editor.stylize.changeBlock("header6", undefined, true);
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Paragraph",
            type: "checkbox",
            accelerator: "Ctrl+0",
            click: getClientCommand(function () {
                File.editor.stylize.changeBlock("paragraph");
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Increase Heading Level",
            accelerator: "Ctrl+=",
            click: getClientCommand(function () {
                File.editor.stylize.increaseHeaderLevel();
            }, true)
        }, {
            label: "Decrease Heading Level",
            accelerator: "Ctrl+-",
            click: getClientCommand(function () {
                File.editor.stylize.decreaseHeaderLevel();
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Table",
            type: "checkbox",
            accelerator: "Ctrl+T",
            click: getClientCommand(function () {
                File.editor.tableEdit.insertTable();
            }, true)
        }, {
            label: "Code Fences",
            type: "checkbox",
            accelerator: "Ctrl+Shift+K",
            click: getClientCommand(function () {
                File.editor.stylize.toggleFences();
            }, true)
        }, {
            label: "Math Block",
            type: "checkbox",
            accelerator: "Ctrl+Shift+M",
            click: getClientCommand(function () {
                File.editor.stylize.toggleMathBlock();
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Quote",
            type: "checkbox",
            accelerator: "Ctrl+Shift+Q",
            click: getClientCommand(function () {
                File.editor.stylize.toggleIndent("blockquote");
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Ordered List",
            type: "checkbox",
            accelerator: "Ctrl+Shift+[",
            click: getClientCommand(function () {
                File.editor.stylize.toggleIndent("ol");
            }, true)
        }, {
            label: "Unordered List",
            type: "checkbox",
            accelerator: "Ctrl+Shift+]",
            click: getClientCommand(function () {
                File.editor.stylize.toggleIndent("ul");
            }, true)
        }, {
            label: "Task List",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.toggleIndent("tasklist");
            }, true)
        }, {
            label: "Task Status",
            submenu: [{
                label: "Toggle Task Status",
                click: getClientCommand(function () {
                    File.editor.stylize.toggleTaskStatus();
                }, true)
            }, {
                type: 'separator'
            }, {
                label: "Mark as Complete",
                type: "checkbox",
                click: getClientCommand(function () {
                    File.editor.stylize.toggleTaskStatus(true);
                }, true)
            }, {
                label: "Mark as Incomplete",
                type: "checkbox",
                click: getClientCommand(function () {
                    File.editor.stylize.toggleTaskStatus(false);
                }, true)
            }]
        }, {
            label: "List Indentation",
            submenu: [{
                label: "Indent",
                accelerator: "CmdOrCtrl+]",
                click: getClientCommand(function () {
                    File.editor.UserOp.moreIndent(File.editor);
                }, true)
            }, {
                label: "Outdent",
                accelerator: "CmdOrCtrl+[",
                click: getClientCommand(function () {
                    File.editor.UserOp.lessIndent(File.editor);
                }, true)
            }]
        }, {
            type: 'separator'
        }, {
            label: "Link Reference",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.insertBlock("def_link");
            }, true)
        }, {
            label: "Footnotes",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.insertBlock("def_footnote");
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Horizontal Line",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.insertBlock("hr");
            }, true)
        }, {
            label: "Table of Contents",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.insertBlock("toc");
            }, true)
        }, {
            label: "YAML Front Matter",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.insertMetaBlock();
            }, true)
        }]
    }), processMenu({
        label: 'F&ormat',
        submenu: [{
            label: "Strong",
            type: "checkbox",
            accelerator: "CmdOrCtrl+B",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("strong");
            }, true)
        }, {
            label: "Emphasis",
            type: "checkbox",
            accelerator: "CmdOrCtrl+I",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("em");
            }, true)
        }, {
            label: "Underline",
            type: "checkbox",
            accelerator: "CmdOrCtrl+U",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("underline");
            }, true)
        }, {
            label: "Code",
            type: "checkbox",
            accelerator: "CmdOrCtrl+Shift+`",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("code");
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Inline Math",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("inline_math");
            }, true)
        }, {
            label: "Strike",
            type: "checkbox",
            accelerator: "Alt+Shift+5",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("del");
            }, true)
        }, {
            label: "Highlight",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("highlight");
            }, true)
        }, {
            label: "Superscript",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("superscript");
            }, true)
        }, {
            label: "Subscript",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("subscript");
            }, true)
        }, {
            label: "Comment",
            type: "checkbox",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("comment");
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Hyperlink",
            type: "checkbox",
            accelerator: "Ctrl+K",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("link");
            }, true)
        }, {
            label: "Image",
            type: "checkbox",
            accelerator: "CmdOrCtrl+Shift+I",
            click: getClientCommand(function () {
                File.editor.stylize.toggleStyle("image");
            }, true)
        }, {
            type: 'separator'
        }, {
            label: "Clear Format",
            type: "checkbox",
            accelerator: "CmdOrCtrl+\\",
            click: getClientCommand(function () {
                File.editor.stylize.clearStyle();
            }, true)
        }]
    }), processMenu({
        label: '&View',
        submenu: [{
            label: 'Toggle Sidebar',
            accelerator: "CmdOrCtrl+Shift+L",
            click: getClientCommand(function () {
                File.editor.library.toggleSidebar();
            }, true)
        }, {
            label: 'Outline',
            type: "checkbox",
            accelerator: "CmdOrCtrl+Shift+1",
            click: getClientCommand("toggleOutline")
        }, {
            label: 'Articles',
            type: "checkbox",
            accelerator: "CmdOrCtrl+Shift+2",
            click: getClientCommand("toggleFileList")
        }, {
            label: 'File Tree',
            type: "checkbox",
            accelerator: "CmdOrCtrl+Shift+3",
            click: getClientCommand("toggleFileTree")
        }, {
            type: 'separator'
        }, {
            label: 'Source Code Mode',
            type: "checkbox",
            accelerator: "CmdOrCtrl+/",
            click: getClientCommand(function () {
                File.toggleSourceMode();
            }, true)
        }, {
            type: 'separator'
        }, {
            label: 'Focus Mode',
            type: "checkbox",
            accelerator: "F8",
            click: getClientCommand(function () {
                File.editor.toggleFocusMode();
            }, true),
            enabled: false
        }, {
            label: 'Typewriter Mode',
            type: "checkbox",
            accelerator: "F9",
            click: getClientCommand(function () {
                File.editor.toggleTypeWriterMode();
            }, true),
            enabled: false
        }, {
            type: 'separator'
        }, {
            label: 'Show Status Bar',
            type: "checkbox",
            click: function () {
                execForAll(function () {
                    document.body.classList.toggle("show-footer");
                });
            }
        }, {
            type: 'separator'
        }, {
            label: 'Toggle Fullscreen',
            accelerator: 'F11',
            click: function (item, focusedWindow) {
                if (focusedWindow.isFullScreen()) {
                    focusedWindow.setFullScreen(false);
                } else {
                    focusedWindow.setFullScreen(true);
                }
            }
        }, {
            label: 'Always on Top',
            type: "checkbox",
            click: function (item, focusedWindow) {
                performClientCommand(function () {
                    document.body.classList.toggle("always-on-top");
                }, true);
                focusedWindow.setAlwaysOnTop(!focusedWindow.isAlwaysOnTop());
            }
        }, {
            type: 'separator'
        }, {
            label: 'Actual Size',
            type: "checkbox",
            accelerator: 'Ctrl+Shift+0',
            click: function (item, focusedWindow) {
                execForAll(function () {
                    ClientCommand.resetZoom();
                });
                performClientCommand(function () {
                    ClientCommand.refreshViewMenu();
                }, true);
            }
        }, {
            label: 'Zoom In',
            accelerator: 'Ctrl+Shift+=',
            click: function (item, focusedWindow) {
                execForAll(function () {
                    ClientCommand.zoomIn();
                });
                performClientCommand(function () {
                    ClientCommand.refreshViewMenu();
                }, true);
            }
        }, {
            label: 'Zoom Out',
            accelerator: 'Ctrl+Shift+-',
            click: function (item, focusedWindow) {
                execForAll(function () {
                    ClientCommand.zoomOut();
                });
                performClientCommand(function () {
                    ClientCommand.refreshViewMenu();
                }, true);
            }
        }, {
            type: 'separator'
        }, {
            label: 'Switch Between Opened Documents',
            accelerator: 'Ctrl+Tab',
            click: function (item, focusedWindow) {
                var windows = BrowserWindow.getAllWindows(),
                    curIndex = windows.indexOf(focusedWindow);

                if (curIndex == -1) return;

                curIndex++;
                curIndex = curIndex >= windows.length ? 0 : curIndex;
                windows[curIndex].focus();
            }
        }, {
            type: 'separator'
        }, {
            label: 'Toggle DevTools',
            accelerator: 'Shift+F12',
            role: 'toggledevtools'
        }]
    }), processMenu({
        label: '&Themes',
        submenu: []
    }), processMenu({
        label: '&Help',
        submenu: [{
            label: 'Quick Start',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Quick Start.md");
            }
        }, {
            label: 'Markdown Reference',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Markdown Reference.md");
            }
        }, {
            label: 'Install and Use Pandoc',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Install and Use Pandoc.md");
            }
        }, {
            label: 'Custom Themes',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Custom Themes.md");
            }
        }, {
            label: 'Use Images in Typora',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Use Images in Typora.md");
            }
        }, {
            label: 'Data Recovery and Version Control',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Auto Save, Version Control and Recovery.md");
            }
        }, {
            label: 'More Topics…',
            click: function (item, focusedWindow) {
                electron.shell.openExternal("http://support.typora.io");
            }
        }, {
            type: 'separator'
        }, {
            label: 'Credits',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Credits.md");
            }
        }, {
            label: 'Change Log',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Change Log.md");
            }
        }, {
            label: 'Privacy Policy',
            click: function (item, focusedWindow) {
                app.openFile(t_workingDir + "/Docs/Privacy Policy.md");
            }
        }, {
            label: 'Website',
            click: function () {
                electron.shell.openExternal("http://typora.io");
            }
        }, {
            label: 'Feedback',
            click: function (item, focusedWindow) {
                electron.shell.openExternal("mailto:hi@typora.io");
            }
        }, {
            type: 'separator'
        }, {
            label: 'Check Updates…',
            click: function () {
                performClientCommand(function () {
                    var winSparkle = File.isWin && reqnode("winsparkle-node");
                    winSparkle.setAppcastUrl("https://www.typora.io/windows/dev_update.xml");
                    winSparkle.checkUpdateWithUI();
                }, true);
            },
            visible: isWin
        }, {
            label: 'About',
            click: getClientCommand(function () {
                if (document.body.classList.contains("native-window")) {
                    $('.modal:not(.block-modal)').modal('hide');
                    $("#about-dialog").modal('show');
                    $("*:focus").blur();
                } else {
                    File.megaMenu.show();
                    $("#m-about").trigger("click");
                }
            }, true)
        }]
    })];

    if (isLinux) {
        template[0].submenu.splice(template[0].submenu.indexOf(null), 1);
    }

    Menu.prototype.getItem = function (label) {
        if (!label) return null;
        var length = this.getItemCount();
        for (var i = 0; i < length; i++) {
            var menuLabel = this.items[i].label.replace(/\(&[A-Z]\)/, '').replace(/[&\.…]/g, '');
            label = label.replace(/[&\.…]/g, '');
            if (menuLabel == label || menuLabel == getLocalizedLabel(label)) {
                return this.items[i];
            }
        }
        return null;
    };

    MenuItem.prototype.setEnabled = function (enabled) {
        this.enabled = enabled;
    };

    MenuItem.prototype.setHidden = function (hidden) {
        this.visible = !hidden;
    };

    MenuItem.prototype.setState = function (state) {
        this.checked = state;
    };

    var menu = Menu.buildFromTemplate(template);
    updateRecentFilesInMenu(menu);
    Menu.setApplicationMenu(menu);
}

exports.bindMainMenu = bindMainMenu;
exports.refreshMenu = refreshMenu;
