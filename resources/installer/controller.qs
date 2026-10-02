eval(installer.readFile(":/katarune/common.qs", "UTF-8"));

function Controller() {
    this.actionConnections = {};
    installer.setMessageBoxAutomaticAnswer("cancelInstallation", QMessageBox.Yes);
    installer.setValue("KataruneReady", "false");
    if (!installer.isInstaller()) {
        if (installer.isCommandLineInstance()) installer.setUninstaller();
        else {
            // Pure uninstall mode skips component metadata and its .ui files.
            // Load local UI metadata; the shared options page selects uninstall.
            installer.setPackageManager();
            installer.addUserRepositories(["file:///" + installer.fromNativeSeparators(installer.value("TargetDir")) + "/.installer/ui-repository"]);
        }
    }
    else if (installer.containsValue("KataruneTarget")) installer.setValue("TargetDir", installer.value("KataruneTarget"));
    else installer.setValue("TargetDir", installer.environmentVariable("LOCALAPPDATA") + "/Programs/@@PRODUCT@@");
    [QInstaller.TargetDirectory, QInstaller.ComponentSelection, QInstaller.LicenseCheck, QInstaller.StartMenuSelection]
        .forEach(function (page) { installer.setDefaultPageVisible(page, false); });
    installer.setDefaultPageVisible(QInstaller.ReadyForInstallation, false);
    if (installer.isCommandLineInstance()) {
        if (installer.isInstaller() && !installer.containsValue("KataruneTarget")) throw new Error("CLI 安装请提供 KataruneTarget=安装目录。");
        KatarunePrepare(installer.value("TargetDir"));
    }
    installer.installationStarted.connect(this, Controller.prototype.operationStarted);
    installer.uninstallationStarted.connect(this, Controller.prototype.operationStarted);
    installer.uninstallationFinished.connect(this, Controller.prototype.cleanupAfterUninstall);
    gui.finishButtonClicked.connect(this, Controller.prototype.launchApplication);
}

Controller.prototype.resetContent = function (canvas) {
    ["InstallOptions", "DeleteAll", "Status", "ArtProgress", "Stage", "Feedback"].forEach(function (name) { gui.findChild(canvas, name).hide(); });
    gui.findChild(canvas, "Feedback").text = "";
};

Controller.prototype.bindActions = function (canvas, key, buttonId) {
    var primary = gui.findChild(canvas, "Primary");
    var cancel = gui.findChild(canvas, "Cancel");
    primary.enabled = true;
    cancel.enabled = gui.isButtonEnabled(buttons.CancelButton);
    if (!this.actionConnections) this.actionConnections = {};
    if (this.actionConnections[key]) return;
    this.actionConnections[key] = true;
    primary.clicked.connect(this, function () {
        if (!gui.isButtonEnabled(buttonId)) return;
        var feedback = gui.findChild(canvas, "Feedback");
        feedback.hide();
        primary.enabled = false;
        gui.clickButton(buttonId);
    });
    cancel.clicked.connect(function () {
        if (gui.isButtonEnabled(buttons.CancelButton)) {
            cancel.enabled = false;
            gui.clickButton(buttons.CancelButton);
        }
    });
};

Controller.prototype.cleanupAfterUninstall = function () {
    if (installer.status !== QInstaller.Success || installer.value("KataruneUpdate", "false") === "true") return;
    try { KataruneRunCleanup("Clean"); }
    catch (error) {
        installer.setValue("KataruneCleanupError", error.message);
        if (installer.isCommandLineInstance()) throw error;
        QMessageBox.critical("KataruneCleanup", "言奏", error.message, QMessageBox.Ok);
    }
};

Controller.prototype.IntroductionPageCallback = function () { gui.clickButton(buttons.NextButton); };

Controller.prototype.DynamicOptionsCallback = function () {
    var page = gui.pageWidgetByObjectName("DynamicOptions");
    var wizardPage = gui.pageByObjectName("DynamicOptions");
    wizardPage.title = "";
    wizardPage.subTitle = "";
    Controller.prototype.resetContent.call(this, page);
    if (!installer.isInstaller()) {
        installer.setUninstaller();
        var status = gui.findChild(page, "Status");
        status.text = "卸载言奏";
        status.show();
        var choice = gui.findChild(page, "DeleteAll");
        choice.checked = installer.value("DeleteAll", "false") === "true";
        choice.show();
        var primary = gui.findChild(page, "Primary");
        primary.text = choice.checked ? "删除数据并卸载" : "卸载";
        Controller.prototype.bindActions.call(this, page, "uninstall-options", buttons.NextButton);
        if (!this.uninstallOptionsConnected) {
            this.uninstallOptionsConnected = true;
            choice.toggled.connect(function (checked) { primary.text = checked ? "删除数据并卸载" : "卸载"; });
        }
        return;
    }
    var options = gui.findChild(page, "InstallOptions");
    options.show();
    options.Path.text = installer.toNativeSeparators(installer.value("TargetDir"));
    options.Path.cursorPosition = 0;
    options.Path.toolTip = options.Path.text;
    options.Desktop.checked = installer.value("DesktopShortcut", "true") === "true";
    options.Launch.checked = false;
    gui.findChild(page, "Primary").text = "安装";
    Controller.prototype.bindActions.call(this, page, "install-options", buttons.NextButton);
    if (!this.optionsConnected) {
        this.optionsConnected = true;
        options.Browse.clicked.connect(function () {
            var selected = QFileDialog.getExistingDirectory("安装位置", options.Path.text);
            if (selected) { options.Path.text = installer.toNativeSeparators(selected); options.Path.toolTip = options.Path.text; }
        });
    }
};

Controller.prototype.operationStarted = function () {
    if (installer.isCommandLineInstance()) return;
    var page = gui.pageById(QInstaller.PerformInstallation);
    page.title = "";
    gui.findChild(page.Progress, "Cancel").enabled = gui.isButtonEnabled(buttons.CancelButton);
};

Controller.prototype.PerformInstallationPageCallback = function () {
    var page = gui.pageById(QInstaller.PerformInstallation);
    if (page.DetailsBrowser.visible) page.DetailsButton.click();
    page.title = "";
    page.subTitle = "";
    [page.ProgressBar, page.ProgressLabel, page.DownloadStatus, page.DetailsButton, page.DetailsBrowser, page.ProductImagesScrollArea]
        .forEach(function (widget) { if (widget) widget.hide(); });
    var canvas = page.Progress;
    Controller.prototype.resetContent.call(this, canvas);
    var status = gui.findChild(canvas, "Status");
    status.text = installer.isInstaller() ? "正在安装" : "正在卸载";
    status.show();
    var progress = gui.findChild(canvas, "ArtProgress");
    progress.minimum = page.ProgressBar.minimum;
    progress.maximum = page.ProgressBar.maximum;
    progress.value = page.ProgressBar.value;
    progress.show();
    var primary = gui.findChild(canvas, "Primary");
    primary.text = installer.isInstaller() ? "安装中" : "卸载中";
    Controller.prototype.bindActions.call(this, canvas, "progress", buttons.CommitButton);
    primary.enabled = false;
    page.ProgressBar.valueChanged.connect(function (value) { progress.value = value; page.title = ""; });
    installer.titleMessageChanged.connect(function (message) {
        page.title = "";
        var stage = gui.findChild(canvas, "Stage");
        stage.text = message;
        stage.visible = !!message;
    });
};

Controller.prototype.FinishedPageCallback = function () {
    var page = gui.pageById(QInstaller.InstallationFinished);
    page.title = "";
    page.subTitle = "";
    [page.MessageLabel, page.LocationLabel, page.FinishText, page.ClickFinishLabel, page.RunItCheckBox]
        .forEach(function (widget) { if (widget) widget.hide(); });
    var canvas = page.Finished;
    Controller.prototype.resetContent.call(this, canvas);
    var status = gui.findChild(canvas, "Status");
    status.text = installer.status === QInstaller.Success ? (installer.isInstaller() ? "安装完成" : "卸载完成") : "操作未完成";
    if (installer.containsValue("KataruneCleanupError")) status.text = "程序已卸载，数据清理失败";
    status.show();
    gui.findChild(canvas, "Primary").text = "完成";
    Controller.prototype.bindActions.call(this, canvas, "finished", buttons.FinishButton);
    gui.findChild(canvas, "Cancel").hide();
};

Controller.prototype.launchApplication = function () {
    if (installer.isInstaller() && installer.status === QInstaller.Success && installer.value("LaunchApplication", "false") === "true")
        installer.executeDetached(installer.value("TargetDir") + "/@@EXE@@", [], installer.value("TargetDir"));
};

