// Preparation and cleanup shared by the native wizard validator and controller.
function KatarunePrepare (target) {
    if (installer.isProcessRunning("@@EXE@@") ||
        installer.isProcessRunning(installer.fromNativeSeparators(target) + "/resources/avatar/KataruneAvatar.exe")) {
        throw new Error("请先退出言奏。");
    }
    target = installer.fromNativeSeparators(target).replace(/\/+$/, "");
    if (!/^[A-Za-z]:\/.+/.test(target) || /(?:^|\/)\.\.(?:\/|$)/.test(target)) {
        throw new Error("请选择有效的安装位置。");
    }
    installer.setValue("TargetDir", target);
    if (installer.isInstaller()) {
        KataruneCheckTarget("Validate", target);
        var previous = target + "/Uninstall @@PRODUCT@@.exe";
        if (installer.fileExists(previous)) {
            if (!installer.fileExists(target + "/.installer/identity.json") ||
                JSON.parse(installer.readFile(target + "/.installer/identity.json", "UTF-8")).product !== "@@PRODUCT@@") {
                throw new Error("该目录已有其他安装，请选择其他位置。");
            }
            // Qt owns the file inventory. Remove its tracked files before
            // installing the new offline payload, including obsolete files.
            var update = installer.execute(previous, ["--confirm-command", "purge", "KataruneUpdate=true"]);
            if (update[1] !== 0) { throw new Error("覆盖更新失败，请退出言奏后重试。"); }
            // Windows maintenance tools finish by scheduling their own removal.
            // Wait for that removal before Qt validates the new target directory.
            KataruneCheckTarget("Wait", target);
        }
    } else if (installer.value("KataruneUpdate", "false") !== "true") {
        KataruneRunCleanup("Validate");
    }
    installer.setValue("KataruneReady", "true");
}

function KataruneRunCleanup (action) {
    var temporary = installer.environmentVariable("TEMP") + "/katarune-cleanup-" +
        Math.random().toString(16).slice(2) + ".ps1";
    if (!installer.performOperation("Copy", [":/katarune/cleanup.ps1", temporary])) {
        throw new Error("无法准备卸载清理。");
    }
    try {
        var result = installer.execute(installer.environmentVariable("SystemRoot") +
            "/System32/WindowsPowerShell/v1.0/powershell.exe", ["-NoProfile", "-NonInteractive",
            "-ExecutionPolicy", "Bypass", "-File", temporary, "-Action", action,
            "-DataName", "@@DATANAME@@", "-UnityProduct", "@@UNITYPRODUCT@@",
            "-DeleteAll", installer.value("DeleteAll", "false")], "", "UTF-8", "UTF-8");
        if (result[1] !== 0) throw new Error("清理失败，请关闭占用文件的程序后重试。\n" + result[0]);
    } finally {
        installer.performOperation("Delete", [temporary]);
    }
}

function KataruneCheckTarget (action, target) {
    var temporary = installer.environmentVariable("TEMP") + "/katarune-prepare-" +
        Math.random().toString(16).slice(2) + ".ps1";
    if (!installer.performOperation("Copy", [":/katarune/prepare.ps1", temporary])) {
        throw new Error("无法准备安装。");
    }
    try {
        var result = installer.execute(installer.environmentVariable("SystemRoot") +
            "/System32/WindowsPowerShell/v1.0/powershell.exe", ["-NoProfile", "-NonInteractive",
            "-ExecutionPolicy", "Bypass", "-File", temporary, "-Action", action,
            "-TargetDir", target, "-Product", "@@PRODUCT@@"], "", "UTF-8", "UTF-8");
        if (result[1] !== 0) { throw new Error("无法安装到所选位置。\n" + result[0]); }
    } finally {
        installer.performOperation("Delete", [temporary]);
    }
}

