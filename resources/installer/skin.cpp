// Katarune's visual layer only. NSIS retains installation, navigation and removal.
// Build as x86 Unicode: the NSIS stub is x86 even for an x64 application payload.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shellapi.h>
#include <gdiplus.h>
#include <algorithm>
#include <memory>
#include <string>
#include <vector>
#ifdef KATARUNE_SKIN_TEST
#include <cstdio>
#endif
using namespace Gdiplus;

namespace {
HWND window, pathEdit, choice, action, browse, closeButton, minimizeButton;
WNDPROC previous;
ULONG_PTR gdiplus;
std::unique_ptr<Image> background, logo;
std::vector<HFONT> fonts;
std::wstring version, currentPath, progressLog;
int page = 0, percent = 0;
bool checked = true, busy = false, closeRequested = false;
float scale = 1;
HICON folderIcon;
HDC backdropDC;
HBITMAP backdropBitmap;
HGDIOBJ originalBackdrop;
constexpr int Width = 950, Height = 612;
constexpr int PathId = 2001, ChoiceId = 2002, ActionId = 2003, BrowseId = 2004;
constexpr int CloseId = 2005, MinimizeId = 2006;
constexpr UINT_PTR ProgressTimer = 0x4b41;
int px(float value);
#ifdef KATARUNE_SKIN_TEST
constexpr UINT_PTR TestTimer = 0x4b42;
wchar_t testTrace[32768], testTarget[32768], testChoice[8];
void trace(const char* event, const RECT* rect = nullptr) {
    if (!testTrace[0]) return;
    FILE* file = nullptr;
    if (_wfopen_s(&file, testTrace, L"a") != 0 || !file) return;
    HRGN region = CreateRectRgn(0, 0, 0, 0);
    int regionType = GetWindowRgn(window, region);
    bool roundedWindow = !PtInRegion(region, 0, 0) && PtInRegion(region, px(400), px(300));
    DeleteObject(region);
    fprintf(file, "{\"event\":\"%s\",\"page\":%d,\"caption\":%s,\"rounded\":%s,\"multiline\":%s,\"regionType\":%d,\"minimized\":%s,\"x\":%ld,\"y\":%ld,\"width\":%ld,\"height\":%ld}\n",
        event, page, (GetWindowLongPtrW(window, GWL_STYLE) & WS_CAPTION) ? "true" : "false",
        roundedWindow ? "true" : "false", pathEdit && (GetWindowLongPtrW(pathEdit, GWL_STYLE) & ES_MULTILINE) ? "true" : "false",
        regionType, IsIconic(window) ? "true" : "false",
        rect ? rect->left : 0, rect ? rect->top : 0, rect ? rect->right - rect->left : 0, rect ? rect->bottom - rect->top : 0);
    fclose(file);
}
#endif
int px(float value) { return static_cast<int>(value * scale + .5f); }

std::unique_ptr<GraphicsPath> rounded(float x, float y, float w, float h, float r) {
    auto result = std::make_unique<GraphicsPath>();
    result->AddArc(x, y, r * 2, r * 2, 180, 90);
    result->AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
    result->AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90);
    result->AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
    result->CloseFigure();
    return result;
}
void text(Graphics& g, const wchar_t* value, float x, float y, float w, float h,
          float size, Color color = Color(255, 65, 60, 54), bool center = false,
          const wchar_t* familyName = L"Microsoft YaHei UI", int style = FontStyleRegular) {
    FontFamily family(familyName);
    Font font(&family, size, style, UnitPixel);
    SolidBrush brush(color);
    StringFormat format;
    format.SetLineAlignment(StringAlignmentCenter);
    format.SetAlignment(center ? StringAlignmentCenter : StringAlignmentNear);
    format.SetTrimming(StringTrimmingEllipsisCharacter);
    g.DrawString(value, -1, &font, RectF(x, y, w, h), &format, &brush);
}
void backdrop(Graphics& g) {
    g.SetSmoothingMode(SmoothingModeAntiAlias);
    g.SetInterpolationMode(InterpolationModeHighQualityBicubic);
    g.SetTextRenderingHint(TextRenderingHintAntiAliasGridFit);
    g.Clear(Color(255, 250, 248, 245));
    if (background) g.DrawImage(background.get(), RectF(0, 0, Width, Height));
    // Fade the scene into white before the controls; keep the left artwork clear.
    // Multiple stops create a broad white surface without a visible panel edge.
    // Cover the whole canvas and mirror the brush edges, so sampling at the
    // transparent start cannot wrap around to the opaque white endpoint.
    LinearGradientBrush veil(PointF(0, 0), PointF(Width, 0),
        Color(0, 255, 255, 255), Color(255, 255, 255, 255));
    Color veilColors[]{Color(0, 255, 255, 255), Color(0, 255, 255, 255), Color(220, 255, 255, 255),
        Color(246, 255, 255, 255), Color(255, 255, 255, 255)};
    REAL veilStops[]{0.f, 420.f / Width, 526.f / Width, 711.5f / Width, 1.f};
    veil.SetInterpolationColors(veilColors, veilStops, 5);
    veil.SetWrapMode(WrapModeTileFlipX);
    g.FillRectangle(&veil, 0.f, 0.f, static_cast<float>(Width), static_cast<float>(Height));
    if (logo) g.DrawImage(logo.get(), RectF(640, 64, 150, 150));
    FontFamily titleFamily(L"Segoe Print");
    StringFormat titleFormat;
    titleFormat.SetAlignment(StringAlignmentCenter);
    titleFormat.SetLineAlignment(StringAlignmentCenter);
    GraphicsPath title;
    title.AddString(L"katarune", -1, &titleFamily, FontStyleRegular, 44, RectF(532, 208, 366, 75), &titleFormat);
    RectF titleBounds;
    title.GetBounds(&titleBounds);
    Matrix centerTitle;
    centerTitle.Translate(715 - titleBounds.X - titleBounds.Width / 2, 0);
    title.Transform(&centerTitle);
    title.GetBounds(&titleBounds);
    SolidBrush ink(Color(255, 32, 30, 28));
    g.FillPath(&ink, &title);
    float badgeX = titleBounds.GetRight() + 8;
    float badgeY = titleBounds.GetBottom() - 18;
    auto badge = rounded(badgeX, badgeY, 54, 18, 9);
    SolidBrush badgeFill(Color(235, 239, 234, 222));
    g.FillPath(&badgeFill, badge.get());
    text(g, version.c_str(), badgeX, badgeY, 54, 18, 11, Color(255, 126, 110, 82), true,
        L"Microsoft YaHei UI", FontStyleBold);
}
void content(Graphics& g) {
    g.SetSmoothingMode(SmoothingModeAntiAlias);
    g.SetTextRenderingHint(TextRenderingHintAntiAliasGridFit);
    if (page == 0) {
        text(g, L"安装位置", 532, 345, 366, 23, 12);
        auto field = rounded(532, 374, 366, 30, 7);
        SolidBrush paper(Color(255, 255, 253, 250));
        Pen edge(Color(255, 226, 222, 215));
        g.FillPath(&paper, field.get());
        g.DrawPath(&edge, field.get());
    }
    if (page == 1 || page == 4) {
        text(g, page == 1 ? L"正在安装" : L"正在卸载", 532, 345, 366, 23, 12);
        auto track = rounded(532, 383, 321, 12, 6);
        SolidBrush muted(Color(255, 226, 218, 202));
        g.FillPath(&muted, track.get());
        if (percent > 0) {
            auto fill = rounded(532, 383, std::max(12.f, 321.f * percent / 100), 12, 6);
            LinearGradientBrush gold(PointF(532, 383), PointF(853, 383), Color(255, 207, 190, 153), Color(255, 144, 128, 94));
            g.FillPath(&gold, fill.get());
        }
        auto label = std::to_wstring(percent) + L"%";
        text(g, label.c_str(), 862, 374, 36, 30, 12, Color(255, 125, 111, 85), true);
        // One current detail line occupies the former shortcut row.
        FontFamily family(L"Microsoft YaHei UI");
        Font font(&family, 12, FontStyleRegular, UnitPixel);
        SolidBrush ink(Color(255, 110, 104, 94));
        StringFormat format;
        format.SetFormatFlags(StringFormatFlagsNoWrap);
        format.SetLineAlignment(StringAlignmentCenter);
        format.SetTrimming(StringTrimmingEllipsisCharacter);
        g.DrawString(progressLog.c_str(), -1, &font, RectF(532, 416, 366, 27), &format, &ink);
    } else if (page == 2 || page == 5) {
        text(g, page == 2 ? L"安装完成" : L"卸载完成", 532, 385, 366, 50, 27, Color(255, 65, 60, 54), true);
    } else if (page == 3) {
        text(g, L"卸载言奏", 532, 374, 366, 30, 27);
    }
}
void paint(HDC dc, POINT origin = {0, 0}) {
    RECT clip;
    GetClipBox(dc, &clip);
    if (backdropDC) BitBlt(dc, clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top,
        backdropDC, origin.x + clip.left, origin.y + clip.top, SRCCOPY);
    Graphics g(dc);
    g.TranslateTransform(static_cast<float>(-origin.x), static_cast<float>(-origin.y));
    g.ScaleTransform(scale, scale);
    content(g);
}
void cacheBackdrop() {
    if (backdropDC) {
        SelectObject(backdropDC, originalBackdrop);
        DeleteObject(backdropBitmap);
        DeleteDC(backdropDC);
    }
    auto dc = GetDC(window);
    backdropDC = CreateCompatibleDC(dc);
    backdropBitmap = CreateCompatibleBitmap(dc, px(Width), px(Height));
    originalBackdrop = SelectObject(backdropDC, backdropBitmap);
    ReleaseDC(window, dc);
    Graphics g(backdropDC);
    g.ScaleTransform(scale, scale);
    backdrop(g);
}
void invalidateContent() {
    RECT area{px(530), px(343), px(904), px(534)};
    InvalidateRect(window, &area, FALSE);
}
HFONT font(int size, int weight = FW_NORMAL) {
    auto value = CreateFontW(-px(size), 0, 0, 0, weight, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
        DEFAULT_PITCH, L"Microsoft YaHei UI");
    fonts.push_back(value);
    return value;
}
HWND control(const wchar_t* kind, const wchar_t* label, DWORD style, int id,
             int x, int y, int w, int h, int size = 13, int weight = FW_NORMAL) {
    HWND value = CreateWindowExW(0, kind, label, WS_CHILD | WS_VISIBLE | WS_TABSTOP | style,
        px(x), px(y), px(w), px(h), window, reinterpret_cast<HMENU>(id), GetModuleHandleW(nullptr), nullptr);
    SendMessageW(value, WM_SETFONT, reinterpret_cast<WPARAM>(font(size, weight)), TRUE);
    return value;
}
void layout() {
    RECT screen;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &screen, 0);
    int w = px(Width), h = px(Height);
    SetWindowPos(window, nullptr, screen.left + (screen.right - screen.left - w) / 2,
        screen.top + (screen.bottom - screen.top - h) / 2, w, h,
        SWP_NOZORDER | SWP_FRAMECHANGED);
    // A real window region also works on Windows 10, independent of DWM heuristics.
    SetWindowRgn(window, CreateRoundRectRgn(0, 0, w + 1, h + 1, px(24), px(24)), TRUE);
}
void drawControl(DRAWITEMSTRUCT* item) {
    HDC target = item->hDC;
    HDC dc = CreateCompatibleDC(target);
    int width = item->rcItem.right - item->rcItem.left;
    int height = item->rcItem.bottom - item->rcItem.top;
    HBITMAP buffer = CreateCompatibleBitmap(target, width, height);
    auto previousBitmap = SelectObject(dc, buffer);
    RECT box;
    GetWindowRect(item->hwndItem, &box);
    POINT origin{box.left, box.top};
    ScreenToClient(window, &origin);
    paint(dc, origin);
    {
    Graphics g(dc);
    g.ScaleTransform(scale, scale);
    g.SetSmoothingMode(SmoothingModeAntiAlias);
    g.SetTextRenderingHint(TextRenderingHintAntiAliasGridFit);
    float w = (item->rcItem.right - item->rcItem.left) / scale;
    float h = (item->rcItem.bottom - item->rcItem.top) / scale;
    bool pressed = (item->itemState & ODS_SELECTED) != 0;
    wchar_t label[256];
    GetWindowTextW(item->hwndItem, label, 256);
    if (item->CtlID == BrowseId) {
        DrawIconEx(dc, px((w - 18) / 2), px((h - 18) / 2), folderIcon, px(18), px(18), 0, nullptr, DI_NORMAL);
    } else if (item->CtlID == ActionId) {
        auto shape = rounded(0, 0, w - 1, h - 1, 23.f);
        LinearGradientBrush gold(PointF(0, 0), PointF(w, 0),
            Color(255, pressed ? 187 : 211, pressed ? 169 : 195, pressed ? 133 : 160),
            Color(255, 143, 127, 95));
        g.FillPath(&gold, shape.get());
        text(g, label, 0, 0, w, h, 20, Color(255, 255, 253, 248),
            true, L"Microsoft YaHei UI", FontStyleBold);
    } else if (item->CtlID == ChoiceId) {
        auto shape = rounded(0, (h - 15) / 2, 15, 15, 3);
        SolidBrush gold(checked ? Color(255, 143, 127, 95) : Color(255, 255, 253, 248));
        g.FillPath(&gold, shape.get());
        Pen edge(Color(255, 143, 127, 95));
        g.DrawPath(&edge, shape.get());
        if (checked) {
            Pen mark(Color(255, 255, 253, 248), 1.6f);
            g.DrawLine(&mark, 3.f, h / 2, 6.f, h / 2 + 3);
            g.DrawLine(&mark, 6.f, h / 2 + 3, 12.f, h / 2 - 4);
        }
        text(g, label, 23, 0, w - 23, h, 12);
    } else {
        bool enabled = IsWindowEnabled(item->hwndItem);
        bool hovered = enabled && GetPropW(item->hwndItem, L"KataruneHovered");
        bool close = item->CtlID == CloseId;
        if (enabled && (hovered || pressed)) {
            SolidBrush circle(close ? Color(pressed ? 51 : 26, 231, 0, 11)
                : Color(255, pressed ? 232 : 245, pressed ? 232 : 245, pressed ? 232 : 245));
            g.FillEllipse(&circle, (w - 32) / 2, (h - 32) / 2, 32.f, 32.f);
        }
        Color icon = !enabled ? Color(110, 115, 117, 121) :
            (hovered || pressed) ? (close ? Color(255, 231, 0, 11) : Color(255, 26, 28, 31))
            : Color(255, 115, 117, 121);
        Pen stroke(icon, 1.4f);
        if (item->CtlID == CloseId) {
            g.DrawLine(&stroke, w / 2 - 5, h / 2 - 5, w / 2 + 5, h / 2 + 5);
            g.DrawLine(&stroke, w / 2 + 5, h / 2 - 5, w / 2 - 5, h / 2 + 5);
        } else g.DrawLine(&stroke, w / 2 - 6, h / 2, w / 2 + 6, h / 2);
    }
    }
    BitBlt(target, 0, 0, width, height, dc, 0, 0, SRCCOPY);
    SelectObject(dc, previousBitmap);
    DeleteObject(buffer);
    DeleteDC(dc);
}
LRESULT CALLBACK captionButtonProcedure(HWND hwnd, UINT message, WPARAM wp, LPARAM lp, UINT_PTR id, DWORD_PTR) {
    if (message == WM_MOUSEMOVE && IsWindowEnabled(hwnd) && !GetPropW(hwnd, L"KataruneHovered")) {
        SetPropW(hwnd, L"KataruneHovered", reinterpret_cast<HANDLE>(1));
        TRACKMOUSEEVENT tracking{sizeof(tracking), TME_LEAVE, hwnd, 0};
        TrackMouseEvent(&tracking);
        InvalidateRect(hwnd, nullptr, FALSE);
    } else if (message == WM_MOUSELEAVE || message == WM_ENABLE) {
        RemovePropW(hwnd, L"KataruneHovered");
        InvalidateRect(hwnd, nullptr, FALSE);
    } else if (message == WM_NCDESTROY) {
        RemovePropW(hwnd, L"KataruneHovered");
        RemoveWindowSubclass(hwnd, captionButtonProcedure, id);
    }
    return DefSubclassProc(hwnd, message, wp, lp);
}
LRESULT CALLBACK choiceProcedure(HWND hwnd, UINT message, WPARAM wp, LPARAM lp, UINT_PTR, DWORD_PTR) {
    if (message == WM_ERASEBKGND) return 1;
    if (message == WM_PAINT) {
        PAINTSTRUCT ps;
        auto dc = BeginPaint(hwnd, &ps);
        DRAWITEMSTRUCT item{};
        item.hDC = dc;
        item.hwndItem = hwnd;
        item.CtlID = ChoiceId;
        GetClientRect(hwnd, &item.rcItem);
        drawControl(&item);
        EndPaint(hwnd, &ps);
        return 0;
    }
    return DefSubclassProc(hwnd, message, wp, lp);
}
BOOL CALLBACK findProgress(HWND child, LPARAM value) {
    wchar_t cls[64];
    GetClassNameW(child, cls, 64);
    if (_wcsicmp(cls, L"msctls_progress32") == 0) {
        *reinterpret_cast<HWND*>(value) = child;
        return FALSE;
    }
    return TRUE;
}
BOOL CALLBACK findDetails(HWND child, LPARAM value) {
    wchar_t cls[64];
    GetClassNameW(child, cls, 64);
    if (_wcsicmp(cls, WC_LISTVIEWW) == 0) {
        *reinterpret_cast<HWND*>(value) = child;
        return FALSE;
    }
    return TRUE;
}
void clearPage() {
    if (pathEdit) {
        std::vector<wchar_t> value(32768);
        GetWindowTextW(pathEdit, value.data(), static_cast<int>(value.size()));
        currentPath = value.data();
    }
    for (auto h : {pathEdit, choice, action, browse}) if (h) DestroyWindow(h);
    pathEdit = choice = action = browse = nullptr;
}
void showPage(int mode, const wchar_t* path) {
    std::wstring target = path;
    clearPage();
    page = mode;
    closeRequested = false;
    busy = page == 1 || page == 4;
    percent = 0;
    progressLog = page == 1 ? L"正在解压并安装应用文件…" : L"正在准备卸载…";
    EnableWindow(closeButton, !busy);
    if (page == 0) {
        checked = true;
        pathEdit = control(L"EDIT", target.c_str(), ES_AUTOHSCROLL, PathId, 540, 380, 317, 22, 12);
        browse = control(L"BUTTON", L"选择安装位置", BS_OWNERDRAW, BrowseId, 862, 375, 34, 28);
        choice = control(L"BUTTON", L"创建桌面快捷方式", BS_AUTOCHECKBOX, ChoiceId, 532, 416, 366, 27);
    } else if (page == 3) {
        checked = false;
        choice = control(L"BUTTON", L"删除全部本地数据", BS_AUTOCHECKBOX, ChoiceId, 532, 416, 366, 27);
    }
    if (choice) {
        SetWindowSubclass(choice, choiceProcedure, 1, 0);
        SendMessageW(choice, BM_SETCHECK, checked ? BST_CHECKED : BST_UNCHECKED, 0);
    }
    const wchar_t* caption = page == 0 ? L"立即安装" : page == 1 ? L"正在安装" :
        page == 2 ? L"启动言奏" : page == 3 ? L"卸载" : page == 4 ? L"正在卸载" : L"完成";
    if (!busy) action = control(L"BUTTON", caption, BS_OWNERDRAW, ActionId, 532, 483, 366, 48, 20);
    if (busy) SetTimer(window, ProgressTimer, 60, nullptr); else KillTimer(window, ProgressTimer);
    // NSIS may show its native page after the custom callback returns. Keep
    // that page alive for its engine/progress, but place it outside our canvas.
    for (HWND child = GetWindow(window, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        if (GetDlgCtrlID(child) < 2000)
            SetWindowPos(child, nullptr, -5000, -5000, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    invalidateContent();
#ifdef KATARUNE_SKIN_TEST
    trace("page");
#endif
    if (!busy) SetFocus(action);
#ifdef KATARUNE_SKIN_TEST
    trace("page-ready");
    if (testTrace[0]) SetTimer(window, TestTimer, 300, nullptr);
#endif
}
LRESULT CALLBACK procedure(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
    switch (message) {
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        auto dc = BeginPaint(hwnd, &ps);
#ifdef KATARUNE_SKIN_TEST
        trace("paint", &ps.rcPaint);
#endif
        auto memory = CreateCompatibleDC(dc);
        int width = ps.rcPaint.right - ps.rcPaint.left;
        int height = ps.rcPaint.bottom - ps.rcPaint.top;
        auto bitmap = CreateCompatibleBitmap(dc, std::max(1, width), std::max(1, height));
        auto oldBitmap = SelectObject(memory, bitmap);
        paint(memory, {ps.rcPaint.left, ps.rcPaint.top});
        BitBlt(dc, ps.rcPaint.left, ps.rcPaint.top, width, height, memory, 0, 0, SRCCOPY);
        SelectObject(memory, oldBitmap);
        DeleteObject(bitmap);
        DeleteDC(memory);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DRAWITEM: drawControl(reinterpret_cast<DRAWITEMSTRUCT*>(lp)); return TRUE;
    case WM_CTLCOLOREDIT: {
        SetTextColor(reinterpret_cast<HDC>(wp), RGB(65, 60, 54));
        SetBkColor(reinterpret_cast<HDC>(wp), RGB(255, 253, 250));
        static HBRUSH paper = CreateSolidBrush(RGB(255, 253, 250));
        return reinterpret_cast<LRESULT>(paper);
    }
    case WM_NCHITTEST: {
        POINT point{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
        ScreenToClient(hwnd, &point);
        if (point.y < px(60) && point.x < px(850)) return HTCAPTION;
        return HTCLIENT;
    }
    case WM_DPICHANGED:
        scale = HIWORD(wp) / 96.f;
        layout();
        cacheBackdrop();
        SetWindowPos(closeButton, nullptr, px(906), px(4), px(40), px(36), SWP_NOZORDER);
        SetWindowPos(minimizeButton, nullptr, px(860), px(4), px(40), px(36), SWP_NOZORDER);
        showPage(page, currentPath.c_str());
        InvalidateRect(hwnd, nullptr, FALSE);
        return 0;
    case WM_TIMER:
#ifdef KATARUNE_SKIN_TEST
        if (wp == TestTimer) {
            trace("test-timer");
            if (page == 0 || page == 3) {
                KillTimer(hwnd, TestTimer);
                if (page == 0 && testTarget[0]) SetWindowTextW(pathEdit, testTarget);
                trace("test-path");
                if (choice && (testChoice[0] == L'1') != checked) SendMessageW(choice, BM_CLICK, 0, 0);
                trace("test-choice");
                PostMessageW(hwnd, WM_COMMAND, MAKEWPARAM(ActionId, BN_CLICKED), reinterpret_cast<LPARAM>(action));
                trace("test-action");
            } else if (page == 2 || page == 5) {
                KillTimer(hwnd, TestTimer);
                PostMessageW(hwnd, WM_COMMAND, IDCANCEL, 0);
            }
            return 0;
        }
#endif
        if (wp == ProgressTimer) {
            HWND progress = nullptr;
            EnumChildWindows(hwnd, findProgress, reinterpret_cast<LPARAM>(&progress));
            if (progress) {
                PBRANGE range{};
                SendMessageW(progress, PBM_GETRANGE, FALSE, reinterpret_cast<LPARAM>(&range));
                int pos = static_cast<int>(SendMessageW(progress, PBM_GETPOS, 0, 0));
                int next = range.iHigh > range.iLow ? (pos - range.iLow) * 100 / (range.iHigh - range.iLow) : 0;
                if (next != percent) {
                    percent = std::clamp(next, 0, 100);
                    RECT area{px(532), px(374), px(899), px(404)};
                    InvalidateRect(hwnd, &area, FALSE);
                }
            }
            HWND details = nullptr;
            EnumChildWindows(hwnd, findDetails, reinterpret_cast<LPARAM>(&details));
            if (details) {
                int count = static_cast<int>(SendMessageW(details, LVM_GETITEMCOUNT, 0, 0));
                if (count > 0) {
                    wchar_t line[2048]{};
                    LVITEMW item{};
                    item.pszText = line;
                    item.cchTextMax = 2048;
                    SendMessageW(details, LVM_GETITEMTEXTW, count - 1, reinterpret_cast<LPARAM>(&item));
                    if (line[0] && progressLog != line) {
                        progressLog = line;
#ifdef KATARUNE_SKIN_TEST
                        trace("log-update");
#endif
                        RECT area{px(532), px(416), px(899), px(443)};
                        InvalidateRect(hwnd, &area, FALSE);
                    }
                }
            }
            // NSIS enables Next when its real worker has completed. Advance
            // through that native transition, rather than guessing from 100%.
            if (auto next = GetDlgItem(hwnd, IDOK); next && IsWindowEnabled(next)) {
                busy = false;
                KillTimer(hwnd, ProgressTimer);
                PostMessageW(hwnd, WM_COMMAND, IDOK, 0);
            }
            return 0;
        }
        break;
    case WM_COMMAND:
        if (HIWORD(wp) == BN_CLICKED) {
            switch (LOWORD(wp)) {
            case ChoiceId:
                checked = SendMessageW(choice, BM_GETCHECK, 0, 0) == BST_CHECKED;
                if (page == 3) SetWindowTextW(action, checked ? L"删除数据并卸载" : L"卸载");
                InvalidateRect(choice, nullptr, TRUE);
                return 0;
            case BrowseId: {
                IFileOpenDialog* picker = nullptr;
                if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&picker)))) {
                    DWORD options = 0;
                    picker->GetOptions(&options);
                    picker->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR);
                    picker->SetTitle(L"选择安装位置");
                    std::vector<wchar_t> initial(32768);
                    GetWindowTextW(pathEdit, initial.data(), static_cast<int>(initial.size()));
                    IShellItem* initialFolder = nullptr;
                    if (SUCCEEDED(SHCreateItemFromParsingName(initial.data(), nullptr, IID_PPV_ARGS(&initialFolder)))) {
                        picker->SetFolder(initialFolder);
                        initialFolder->Release();
                    }
                    if (SUCCEEDED(picker->Show(hwnd))) {
                        IShellItem* folder = nullptr;
                        if (SUCCEEDED(picker->GetResult(&folder))) {
                            PWSTR path = nullptr;
                            if (SUCCEEDED(folder->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
                                SetWindowTextW(pathEdit, path);
                                CoTaskMemFree(path);
                            }
                            folder->Release();
                        }
                    }
                    picker->Release();
                }
                return 0;
            }
            case ActionId: if (!busy) PostMessageW(hwnd, WM_COMMAND, IDOK, 0); return 0;
            case CloseId: if (!busy) PostMessageW(hwnd, WM_COMMAND, IDCANCEL, 0); return 0;
            case MinimizeId: ShowWindow(hwnd, SW_MINIMIZE); return 0;
            }
        }
        if ((page == 2 || page == 5) && LOWORD(wp) == IDCANCEL) {
            // NSIS disables Cancel on its final page. Advance without launching
            // when the user closes that page, including Escape and Alt+F4.
            closeRequested = true;
            PostMessageW(hwnd, WM_COMMAND, IDOK, 0);
            return 0;
        }
        if (busy && (LOWORD(wp) == IDCANCEL || LOWORD(wp) == IDOK)) return 0;
        break;
    case WM_CLOSE:
        if (!busy && (page == 2 || page == 5)) PostMessageW(hwnd, WM_COMMAND, IDCANCEL, 0);
        else if (!busy) break;
        return 0;
    }
    return CallWindowProcW(previous, hwnd, message, wp, lp);
}
}

extern "C" {
__declspec(dllexport) void __cdecl Attach(HWND parent, const wchar_t* assets, const wchar_t* release) {
    if (window) return;
    // Keep the drawing callbacks alive until process exit; no installer data is owned here.
    HMODULE module;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
        reinterpret_cast<LPCWSTR>(&Attach), &module);
    window = parent;
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    SHSTOCKICONINFO stock{sizeof(stock)};
    if (SUCCEEDED(SHGetStockIconInfo(SIID_FOLDER, SHGSI_ICON | SHGSI_SMALLICON, &stock))) folderIcon = stock.hIcon;
    version = std::wstring(L"v") + release;
    GdiplusStartupInput input;
    GdiplusStartup(&gdiplus, &input, nullptr);
    background = std::make_unique<Image>((std::wstring(assets) + L"\\background.png").c_str());
    logo = std::make_unique<Image>((std::wstring(assets) + L"\\logo.png").c_str());
    auto dpi = reinterpret_cast<UINT(WINAPI*)(HWND)>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow"));
    scale = dpi ? dpi(parent) / 96.f : 1;
    SetWindowLongPtrW(window, GWL_STYLE, WS_POPUP | WS_MINIMIZEBOX | WS_SYSMENU | WS_CLIPCHILDREN);
    SetWindowLongPtrW(window, GWL_EXSTYLE, WS_EX_APPWINDOW);
    previous = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(procedure)));
    layout();
    cacheBackdrop();
    closeButton = control(L"BUTTON", L"关闭", BS_OWNERDRAW, CloseId, 906, 4, 40, 36);
    minimizeButton = control(L"BUTTON", L"最小化", BS_OWNERDRAW, MinimizeId, 860, 4, 40, 36);
    SetWindowSubclass(closeButton, captionButtonProcedure, 1, 0);
    SetWindowSubclass(minimizeButton, captionButtonProcedure, 1, 0);
#ifdef KATARUNE_SKIN_TEST
    GetEnvironmentVariableW(L"KATARUNE_TEST_UI_TRACE", testTrace, 32768);
    GetEnvironmentVariableW(L"KATARUNE_TEST_UI_TARGET", testTarget, 32768);
    GetEnvironmentVariableW(L"KATARUNE_TEST_UI_CHOICE", testChoice, 8);
    if (testTrace[0]) SetTimer(window, TestTimer, 250, nullptr);
#endif
}
__declspec(dllexport) void __cdecl Page(int mode, const wchar_t* path) {
    showPage(mode, path);
}
__declspec(dllexport) void __cdecl PreviewPage(int mode, const wchar_t* path) {
    showPage(mode, path);
    busy = false;
    percent = 45;
    if (mode == 1 || mode == 4) progressLog = mode == 1 ? L"正在解压应用文件…（预览示例）" : L"正在移除应用文件…（预览示例）";
    KillTimer(window, ProgressTimer);
    EnableWindow(action, TRUE);
    EnableWindow(closeButton, TRUE);
    invalidateContent();
}
__declspec(dllexport) void __cdecl ReadPath(wchar_t* buffer, int size) {
    if (pathEdit) GetWindowTextW(pathEdit, buffer, size); else lstrcpynW(buffer, currentPath.c_str(), size);
}
__declspec(dllexport) int __cdecl ReadChoice() { return checked ? 1 : 0; }
__declspec(dllexport) int __cdecl ReadLaunch() { return closeRequested ? 0 : 1; }
__declspec(dllexport) void __cdecl HideNativePage(HWND dialog) {
    SetWindowPos(dialog, nullptr, -5000, -5000, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    for (int id : {1, 2, 3, 1034, 1035, 1036, 1037, 1038, 1039, 1045})
        if (auto child = GetDlgItem(window, id)) ShowWindow(child, SW_HIDE);
}
}
