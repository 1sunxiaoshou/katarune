import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { app, BrowserWindow, screen } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const directory = process.env.KATARUNE_STARTUP_TEST_DIR;
assert.ok(directory, "An isolated startup test directory is required");
app.setAppPath(process.cwd());
app.setPath("userData", join(directory, "user-data"));
app.setPath("sessionData", join(directory, "session-data"));

let passed = false;
const timeout = setTimeout(() => {
  console.error(
    "[startup] Main window and Unity default character did not become ready within 90 seconds",
  );
  app.exit(1);
}, 90_000);

app.once("browser-window-created", async (_event, window) => {
  try {
    await Promise.all([
      once(window, "ready-to-show"),
      once(window.webContents, "did-finish-load"),
    ]);
    assert.equal(
      window.isVisible(),
      true,
      "The real main window must be visible, including when launched with windowsHide",
    );
    await window.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          if (document.querySelector('#root')?.childElementCount > 0) return resolve();
          if (Date.now() > deadline) return reject(new Error('Renderer did not mount'));
          setTimeout(check, 20);
        };
        check();
      })`);
    const state = await window.webContents.executeJavaScript(`window.katarune.getAppState()`);
    assert.equal(state.activeCharacter.packageId, "builtin:default");
    assert.notEqual(state.activeCharacter.packageThumbnailAssetId, state.activeCharacter.packagePortraitAssetId);
    const wait = selector => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000; const check = () => { const element = document.querySelector(${JSON.stringify(selector)});
        if (element && (!(element instanceof HTMLImageElement) || (element.complete && element.naturalWidth > 0))) return resolve();
        if (Date.now() > deadline) return reject(new Error('Missing or unloaded ' + ${JSON.stringify(selector)})); setTimeout(check, 20); }; check();
    })`);
    await wait('[data-testid="settings-launcher"]');
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-launcher"]').click()`);
    await wait('[data-testid="open-diagnostics"]');
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="open-diagnostics"]').scrollIntoView({block: 'center'})`);
    await new Promise(resolve => setTimeout(resolve, 600));
    await writeFile(join(directory, "diagnostics-settings.png"), (await window.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="settings-back"]').click()`);
    await wait('.chat-character-entry .character-list-portrait img');
    const verifyCard = async selector => {
      const image = await window.webContents.executeJavaScript(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const rect = element.parentElement.getBoundingClientRect(); return { src: element.src, width: rect.width, height: rect.height }; })()`);
      assert.ok(image.src.endsWith(state.activeCharacter.packageThumbnailAssetId));
      assert.ok(Math.abs(image.width - image.height) < 1);
    };
    await verifyCard('.chat-character-entry .character-list-portrait img');
    window.webContents.send("character-packages:open", state.activeCharacter.id);
    await wait('[data-testid="character-package-dialog"] .character-package-art img');
    await verifyCard('[data-testid="character-list-item"] .character-list-portrait img');
    await new Promise(resolve => setTimeout(resolve, 350)); // Allow the 200 ms entry transition to paint before capture.
    await writeFile(join(directory, "character-packages.png"), (await window.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-package-dialog"] [data-slot="dialog-close"]').click()`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-back"]').click()`);
    await wait('[data-testid="avatar-toggle"]');
    const avatar = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Avatar did not become ready')); }, 60000);
      unsubscribe = window.katarune.onAvatarStatus(status => {
        if (status.phase === 'ready') { clearTimeout(timeout); unsubscribe(); resolve(status); }
        else if (status.phase === 'error') { clearTimeout(timeout); unsubscribe(); reject(new Error(status.error)); }
      });
      document.querySelector('[data-testid="avatar-toggle"]').click();
    })`);
    assert.equal(avatar.phase, "ready", "The default package must pass the real Unity-to-main message validation");
    assert.equal(avatar.error, null);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const settledAvatar = await window.webContents.executeJavaScript(`window.katarune.getAvatarStatus()`);
    assert.equal(settledAvatar.phase, "ready", "Subsequent Unity control messages must preserve the connection");
    assert.equal(settledAvatar.error, null);
    assert.deepEqual(settledAvatar.binding, avatar.binding, "The real UI binding must remain stable");
    const until = async (condition, message) => {
      const deadline = Date.now() + 5000;
      while (!await condition()) {
        assert.ok(Date.now() < deadline, message);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const desktopWindow = surface => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(`surface=${surface}`));
    await until(() => desktopWindow("capsule")?.isVisible(), "Capsule did not become visible");
    const capsule = desktopWindow("capsule"), panel = desktopWindow("panel");
    await until(() => capsule.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="更多"]')`), "Capsule buttons did not mount");
    assert.equal(capsule.isFocused(), false);
    const capsuleBounds = capsule.getBounds();
    const more = await capsule.webContents.executeJavaScript(`(() => { const r = document.querySelector('button[aria-label="更多"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const clickMore = async (button = more) => {
      capsule.moveTop();
      const currentBounds = capsule.getBounds();
      const point = screen.dipToScreenPoint({ x: currentBounds.x + button.x, y: currentBounds.y + button.y });
      const { stdout } = await promisify(execFile)("pwsh", ["-NoProfile", "-File", resolve("tests/native-desktop-click.ps1"),
        "-X", String(point.x), "-Y", String(point.y), "-WindowHandle", String(capsule.getNativeWindowHandle().readBigUInt64LE()),
        "-OwnerProcessId", String(process.pid)], { windowsHide: true, timeout: 10_000 });
      const native = JSON.parse(stdout);
      assert.ok(native.clicked, `An unrelated window occluded the owned test windows; no click was sent: ${JSON.stringify(native)}`);
    };
    const panelPainted = () => panel.webContents.executeJavaScript(`(() => { const element = document.querySelector('.desktop-panel'); return element?.dataset.phase === 'open' && Number(getComputedStyle(element).opacity) > .99; })()`);
    // A hidden native window may stop delivering animation frames. Opening must
    // depend on committed DOM, rather than waiting for an invisible paint.
    await panel.webContents.executeJavaScript(`window.startupOriginalRaf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; void 0;`);
    await clickMore();
    await until(() => panel.isVisible(), "First click must open the panel without dragging the capsule");
    await until(panelPainted, "Panel content must actually become visible after the first click");
    await panel.webContents.executeJavaScript(`window.requestAnimationFrame = window.startupOriginalRaf; delete window.startupOriginalRaf;`);
    assert.deepEqual(capsule.getBounds(), capsuleBounds);
    assert.equal((await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).panelPhase, "open");
    await panel.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: "close-panel" })`);
    assert.equal(panel.isVisible(), false);
    // The native canvas must stay put while its visible capsule animates.
    const capsuleGeometryEvents = [];
    const recordCapsuleGeometry = () => capsuleGeometryEvents.push(capsule.getBounds());
    capsule.on("move", recordCapsuleGeometry);
    capsule.on("resize", recordCapsuleGeometry);
    const visibleCapsuleWidth = () => capsule.webContents.executeJavaScript(`document.querySelector('.capsule').getBoundingClientRect().width`);
    // Real input focus, IME guard, rejected send and draft recovery.
    window.hide();
    const textButton = await capsule.webContents.executeJavaScript(`(() => { const r = document.querySelector('button[aria-label="文本输入"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    await clickMore(textButton);
    await until(async () => await visibleCapsuleWidth() > 220
      && await capsule.webContents.executeJavaScript(`document.activeElement?.getAttribute('aria-label') === '桌宠消息'`), "Capsule must expand horizontally and focus its input");
    await new Promise(resolve => setTimeout(resolve, 300));
    await writeFile(join(directory, "desktop-input-empty.png"), (await capsule.capturePage()).toPNG());
    assert.equal(window.isVisible(), false, "Text input must not show the chat window");
    assert.deepEqual(capsule.getBounds(), capsuleBounds, "Opening input must preserve the native compositor surface");
    const expandedBounds = capsule.getBounds();
    const workArea = screen.getDisplayMatching(expandedBounds).workArea;
    assert.ok(expandedBounds.x >= workArea.x && expandedBounds.x + expandedBounds.width <= workArea.x + workArea.width);
    await capsule.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('input[aria-label="桌宠消息"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '胶囊输入测试');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await capsule.webContents.executeJavaScript(`document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))`);
    assert.equal(await capsule.webContents.executeJavaScript(`document.querySelector('[role="alert"]') === null`), true);
    await capsule.webContents.executeJavaScript(`document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
    await until(() => capsule.webContents.executeJavaScript(`!!document.querySelector('[role="alert"]')`), "Missing model must report a send error inside the capsule");
    assert.equal(await capsule.webContents.executeJavaScript(`document.querySelector('input').value`), "胶囊输入测试");
    await writeFile(join(directory, "desktop-input.png"), (await capsule.capturePage()).toPNG());
    capsule.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    capsule.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until(async () => !(await capsule.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).inputOpen
      && Math.round(await visibleCapsuleWidth()) === 220, "Escape must restore the visible capsule width");
    assert.deepEqual(capsule.getBounds(), capsuleBounds, "Expansion must not overwrite the saved capsule anchor");
    await capsule.webContents.executeJavaScript(`document.querySelector('button[aria-label="文本输入"]').click()`);
    await until(() => capsule.webContents.executeJavaScript(`document.activeElement?.getAttribute('aria-label') === '桌宠消息'`), "Input must focus when reopened");
    assert.equal(await capsule.webContents.executeJavaScript(`document.querySelector('input').value`), "胶囊输入测试");
    await capsule.webContents.executeJavaScript(`document.querySelector('button[aria-label="关闭输入"]').click()`);
    await until(async () => Math.round(await visibleCapsuleWidth()) === 220, "Closing input must restore the visible capsule width");
    // Reversing a transition must not move/resize the HWND or jump its anchor.
    await capsule.webContents.executeJavaScript(`(() => {
      window.capsuleSwitchFrames = [];
      window.capsuleSwitchSampling = true;
      const sample = () => {
        const element = document.querySelector('.capsule'), r = element.getBoundingClientRect();
        window.capsuleSwitchFrames.push({ width: r.width, anchor: element.dataset.inputAnchor === 'right' ? r.right : r.left });
        if (window.capsuleSwitchSampling) requestAnimationFrame(sample);
      };
      sample();
    })()`);
    for (let index = 0; index < 6; index++) {
      await capsule.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: 'input' })`);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    await until(async () => Math.round(await visibleCapsuleWidth()) === 220, "Rapid toggles must settle at normal width");
    await capsule.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: 'compact' })`);
    await until(async () => Math.round(await visibleCapsuleWidth()) === 100, "Compact mode must settle at its visible width");
    await capsule.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: 'compact' })`);
    await until(async () => Math.round(await visibleCapsuleWidth()) === 220, "Expanded controls must restore their visible width");
    const switchFrames = await capsule.webContents.executeJavaScript(`window.capsuleSwitchSampling = false; window.capsuleSwitchFrames`);
    assert.ok(switchFrames.length >= 4);
    assert.ok(switchFrames.every(frame => Math.abs(frame.anchor - switchFrames[0].anchor) < 1), "The visible capsule anchor must remain stable throughout transitions");
    assert.deepEqual(capsuleGeometryEvents, [], "Input and compact transitions must never resize or move the transparent HWND");
    capsule.removeListener("move", recordCapsuleGeometry);
    capsule.removeListener("resize", recordCapsuleGeometry);
    await writeFile(join(directory, "capsule-switch-frames.json"), JSON.stringify(switchFrames));
    window.show();
    window.focus();
    await clickMore();
    await until(() => panel.isVisible(), "Panel must reopen on the next click");
    await until(panelPainted, "Reopened panel content must paint");
    const actions = (await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).capabilities.actions;
    assert.equal(actions.length, 26);
    assert.ok(actions.some(action => action.kind === "performance" && action.label === "我的悲伤是水做的"));
    assert.ok(actions.some(action => action.semantic === "think"), "The basic thinking pose must remain available");
    assert.ok(!actions.some(action => action.semantic === "thinkGesture"), "The removed thinking gesture must not remain available");
    assert.equal(actions.filter(action => action.idle).length, 3);
    assert.ok(actions.some(action => action.key === "redreaming-angel"));
    assert.ok(actions.some(action => action.key === "point-left"));
    assert.ok(actions.every(action => /[\u4e00-\u9fff]/u.test(action.label)), "Every default action must have a Chinese display name");
    assert.ok(!actions.some(action => action.label.startsWith("完整")), "Removed full-body variants must not remain in the picker");
    await writeFile(join(directory, "desktop-panel.png"), (await panel.capturePage()).toPNG());
    const normalPanelBounds = panel.getBounds();
    const openActions = async () => {
      panel.focus(); panel.webContents.focus();
      await panel.webContents.executeJavaScript(`document.querySelector('[aria-label="动作"]').click()`);
      await until(() => panel.webContents.executeJavaScript(`!!document.querySelector('.desktop-action-content')`), "Action dropdown did not open");
    };
    const filterActions = async label => {
      await panel.webContents.executeJavaScript(`(() => {
        const item = [...document.querySelectorAll('.desktop-action-content [role="tab"]')].find(e => e.textContent === ${JSON.stringify(label)});
        if (!item) throw new Error('Missing action filter'); item.click();
      })()`);
      await until(() => panel.webContents.executeJavaScript(`document.querySelector('.desktop-action-content [role="tab"][data-active]')?.textContent === ${JSON.stringify(label)}`), "Action filter did not change");
    };
    const selectAction = async name => {
      await panel.webContents.executeJavaScript(`(() => {
        const item = [...document.querySelectorAll('.desktop-action-content [cmdk-item]')].find(e => e.textContent === ${JSON.stringify(name)});
        if (!item) throw new Error('Missing action option'); item.click();
      })()`);
      await until(() => panel.webContents.executeJavaScript(`!document.querySelector('.desktop-action-content')`), "Selection must close the dropdown");
    };
    for (const height of [normalPanelBounds.height, 320]) {
      panel.setBounds({ ...normalPanelBounds, height });
      await openActions();
      const labels = await panel.webContents.executeJavaScript(`[...document.querySelectorAll('.desktop-action-content [role="tab"]')].map(e => e.textContent)`);
      assert.deepEqual(labels, ["单次", "循环", "演出"]);
      for (const [label, kind] of [["单次", "oneShot"], ["循环", "loop"], ["演出", "performance"]]) {
        await filterActions(label);
        const items = await panel.webContents.executeJavaScript(`[...document.querySelectorAll('.desktop-action-content [cmdk-item]')].map(e => e.textContent)`);
        assert.deepEqual(items, actions.filter(a => (a.kind ?? "oneShot") === kind).sort((a,b)=>Number(!!a.idle)-Number(!!b.idle)).map(a => a.label));
      }
      await filterActions("循环");
      await new Promise(resolve => setTimeout(resolve, 150));
      const metrics = await panel.webContents.executeJavaScript(`(() => {
        const popup = document.querySelector('.desktop-action-content'), r = popup.getBoundingClientRect(), list=popup.querySelector('[cmdk-list]');
        return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:innerWidth, height:innerHeight, scroll:list.scrollHeight > list.clientHeight };
      })()`);
      assert.ok(metrics.left >= -1 && metrics.right <= metrics.width + 1 && metrics.top >= -1 && metrics.bottom <= metrics.height + 1, JSON.stringify(metrics));
      assert.ok(metrics.scroll, "Long filtered lists must scroll inside the control window");
      await panel.webContents.executeJavaScript(`document.querySelector('.desktop-action-content input').focus()`);
      for (const keyCode of ["End", "Home"]) {
        panel.webContents.sendInputEvent({ type:"keyDown", keyCode }); panel.webContents.sendInputEvent({ type:"keyUp", keyCode });
        await until(() => panel.webContents.executeJavaScript(`(() => {
          const list=document.querySelector('.desktop-action-content [cmdk-list]'), items=[...list.querySelectorAll('[cmdk-item]')];
          const expected=${JSON.stringify(keyCode)}==='End'?items.at(-1):items[0], selected=list.querySelector('[data-selected="true"]');
          const r=expected.getBoundingClientRect(), p=list.getBoundingClientRect();
          return selected===expected && r.top>=p.top-1 && r.bottom<=p.bottom+1;
        })()`), `Filtered dropdown keyboard navigation must keep ${keyCode} visible at height ${height}`);
      }
      await writeFile(join(directory, `desktop-actions-${height}.png`), (await panel.capturePage()).toPNG());
      await panel.webContents.executeJavaScript(`window.avatarDesktop.command({ operation:'close-panel' })`);
      await until(() => !panel.isVisible(), "Panel did not close");
      assert.equal(await panel.webContents.executeJavaScript(`!!document.querySelector('.desktop-action-content')`), false);
      await clickMore(); await until(panelPainted, "Panel must reopen without stale dropdowns");
    }
    panel.setBounds(normalPanelBounds);
    const angel = actions.find(a => a.key === "redreaming-angel"), sadWater=actions.find(a => a.key === "sad-water"), thinking=actions.find(a=>a.key === "think");
    const actualAction = async id => (await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).presentation?.action === id;
    const verifyPlaying = async name => {
      await until(() => panel.webContents.executeJavaScript(`(() => {
        const item=[...document.querySelectorAll('.desktop-action-content [data-playing="true"]')];
        return item.length===1 && item[0].textContent===${JSON.stringify(name)} && !!item[0].querySelector('svg');
      })()`), `Actual playback must select ${name}`);
    };
    await openActions(); await filterActions("演出"); await selectAction("复梦天使");
    await until(() => actualAction(angel.id), "Selecting the real dance must start the Player");
    await openActions(); await verifyPlaying("复梦天使");
    await until(() => panel.webContents.executeJavaScript(`Number(getComputedStyle(document.querySelector('.desktop-action-content')).opacity) > .99`), "Action popup must finish painting before capture");
    await writeFile(join(directory, "desktop-dance.png"), (await panel.capturePage()).toPNG());
    await selectAction("我的悲伤是水做的");
    await until(() => actualAction(sadWater.id), "A different dance must interrupt and replace the current dance");
    await openActions(); await verifyPlaying("我的悲伤是水做的");
    await filterActions("循环"); await selectAction("思考");
    await until(() => actualAction(thinking.id), "A regular action must interrupt the dance and take over");
    await openActions(); await verifyPlaying("思考"); await selectAction("思考");
    await until(async () => !(await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).presentation?.action, "Clicking the selected loop must stop it and restore idle");
    await openActions(); await filterActions("演出");
    assert.equal(await panel.webContents.executeJavaScript(`document.querySelectorAll('.desktop-action-content [data-playing="true"]').length`), 0);
    await until(() => panel.webContents.executeJavaScript(`document.querySelector('[aria-label="动作"]').textContent === "自动待机"`), "After stopping, the trigger must show automatic idle");
    await selectAction("复梦天使"); await until(() => actualAction(angel.id), "Dance must remain playable after interruption");
    await openActions(); await selectAction("复梦天使");
    await until(async () => !(await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).presentation?.action, "Clicking the selected dance must stop it directly");
    assert.equal((await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).error, null);
    const openedPanel = await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`);
    window.focus();
    await until(() => !panel.isVisible(), "Clicking away must still dismiss the panel");
    await panel.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: "panel-ready", value: ${JSON.stringify(String(openedPanel.panelRevision))} })`);
    assert.equal(panel.isVisible(), false, "A stale readiness message must not reopen a closed panel");
    await clickMore();
    await until(panelPainted, "Panel must reopen for mode selection");
    await panel.webContents.executeJavaScript(`(() => {
      const immersive = [...document.querySelectorAll('[role="tab"]')].find(element => element.textContent === '沉浸');
      if (!immersive) throw new Error('Immersive mode entry is missing');
      immersive.click();
    })()`);
    await until(async () => (await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).mode === "immersive", "Mode entry did not reach main");
    await new Promise(resolve => setTimeout(resolve, 1200));
    const immersive = await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`);
    assert.equal(immersive.status.phase, "ready");
    assert.equal(immersive.cameraView, "overhead");
    assert.equal(immersive.adjusting, false);
    // Windows may keep the Electron panel focused when foreground activation
    // of Unity is denied. Reuse an open panel; clicking More would close it.
    if (!panel.isVisible()) await clickMore();
    await until(panelPainted, "Immersive panel must stay accessible");
    await writeFile(join(directory, "immersive-panel.png"), (await panel.capturePage()).toPNG());
    await panel.webContents.executeJavaScript(`window.avatarDesktop.command({ operation: 'camera-view', value: 'closeup' })`);
    await new Promise(resolve => setTimeout(resolve, 1200));
    const closeup = await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`);
    assert.equal(closeup.status.phase, "ready");
    assert.equal(closeup.cameraView, "closeup");
    // Escape from either Electron control surface must return to the desktop.
    capsule.focus();
    capsule.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    capsule.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until(async () => (await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).mode === "desktop", "Escape from capsule did not exit immersive mode");
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal((await panel.webContents.executeJavaScript(`window.avatarDesktop.getState()`)).status.phase, "ready");
    await writeFile(join(directory, "avatar-startup.json"), JSON.stringify({ avatar, settledAvatar }, null, 2));
    const stoppedAvatar = await window.webContents.executeJavaScript(`window.katarune.stopAvatar()`);
    assert.equal(stoppedAvatar.phase, "stopped");
    passed = true;
    console.log("[startup] Default avatar, filtered dropdown, selected playback and real dance switching/stop, native panels and immersive controls passed: " + directory);
  } catch (error) {
    console.error(error);
  } finally {
    clearTimeout(timeout);
    app.quit();
  }
});
app.once("will-quit", () => {
  if (!passed) app.exit(1);
});
await import(pathToFileURL(resolve("out/main/index.js")).href);
