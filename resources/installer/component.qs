// binarycreator evaluates component scripts with a metadata-only QObject.
if (typeof installer.readFile === "function") {
    eval(installer.readFile(":/katarune/common.qs", "UTF-8"));
}

function Component() {
    if (!installer.isCommandLineInstance()) {
        component.loaded.connect(this, Component.prototype.addPages);
    }
}

Component.prototype.addPages = function () {
    installer.addWizardPage(component, "Options", QInstaller.ReadyForInstallation);
    installer.setValidatorForCustomPage(component, "Options", "validateOptions");
    installer.addWizardPageItem(component, "Progress", QInstaller.PerformInstallation, 0);
    installer.addWizardPageItem(component, "Finished", QInstaller.InstallationFinished, 0);
};

Component.prototype.validateOptions = function () {
    var page = gui.pageWidgetByObjectName("DynamicOptions");
    var options = gui.findChild(page, "InstallOptions");
    var target = installer.value("TargetDir");
    if (installer.isInstaller()) {
        installer.setValue("DesktopShortcut", options.Desktop.checked ? "true" : "false");
        installer.setValue("LaunchApplication", options.Launch.checked ? "true" : "false");
        target = options.Path.text;
    } else {
        installer.setValue("DeleteAll", gui.findChild(page, "DeleteAll").checked ? "true" : "false");
    }
    try {
        KatarunePrepare(target);
        return true;
    } catch (error) {
        var feedback = gui.findChild(page, "Feedback");
        feedback.text = error.message;
        feedback.show();
        gui.findChild(page, "Primary").enabled = true;
        return false;
    }
};

Component.prototype.createOperations = function () {
    component.createOperations();
    component.addOperation("CreateShortcut", "@TargetDir@/@@EXE@@",
        "@StartMenuDir@/@@PRODUCT@@.lnk", "workingDirectory=@TargetDir@");
    component.addOperation("CreateShortcut", "@TargetDir@/Uninstall @@PRODUCT@@.exe",
        "@StartMenuDir@/卸载 @@PRODUCT@@.lnk", "workingDirectory=@TargetDir@");
    if (installer.value("DesktopShortcut", "true") === "true") {
        component.addOperation("CreateShortcut", "@TargetDir@/@@EXE@@",
            "@DesktopDir@/@@PRODUCT@@.lnk", "workingDirectory=@TargetDir@");
    }
};
