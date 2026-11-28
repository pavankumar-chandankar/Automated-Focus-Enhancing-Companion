// Narrow in-process bridge. All pixels and recognized text stay in RAM.
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Vision/Vision.h>
#import <dispatch/dispatch.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static char *json_result(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    if (!data) return strdup("{\"error\":\"Could not encode capture result\"}");
    char *result = malloc(data.length + 1);
    if (!result) return NULL;
    memcpy(result, data.bytes, data.length);
    result[data.length] = 0;
    return result;
}
static char *failure(NSString *message) { return json_result(@{@"error":message}); }
void oplyra_screen_free(char *value) { free(value); }

int oplyra_screen_supported(void) {
    if (@available(macOS 14.0, *)) return 1;
    return 0;
}
int oplyra_screen_request_permission(void) {
    if (@available(macOS 14.0, *)) {
        return CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess();
    }
    return 0;
}

// A conservative initial allowlist of common work applications. No terminals,
// password managers, mail, messaging, system settings, or unknown apps.
static BOOL allowed_bundle(NSString *bundle) {
    if (!bundle) return NO;
    return [@[@"com.apple.Safari", @"com.google.Chrome", @"org.mozilla.firefox",
      @"com.microsoft.edgemac", @"com.brave.Browser", @"com.microsoft.Word",
      @"com.apple.iWork.Pages", @"com.apple.Preview", @"com.apple.TextEdit",
      @"com.microsoft.VSCode", @"md.obsidian", @"com.apple.Notes"] containsObject:bundle];
}
static BOOL eligible(SCWindow *window) API_AVAILABLE(macos(14.0)) {
    SCRunningApplication *owner = window.owningApplication;
    CGRect frame = window.frame;
    return owner && owner.processID != getpid() && owner.processID > 0 &&
        window.windowLayer == 0 && window.isOnScreen &&
        frame.size.width >= 200 && frame.size.height >= 120 &&
        allowed_bundle(owner.bundleIdentifier);
}
static SCShareableContent *shareable(void) API_AVAILABLE(macos(14.0)) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block SCShareableContent *result = nil;
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES
        onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
            if (!error) result = content;
            dispatch_semaphore_signal(done);
        }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 6 * NSEC_PER_SEC))) return nil;
    return result;
}
static NSString *bounded(NSString *s, NSUInteger limit) {
    if (!s) return @"";
    if (s.length <= limit) return s;
    NSRange range = [s rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, limit - 1)];
    return [s substringWithRange:range];
}

char *oplyra_screen_list(void) {
    @autoreleasepool {
        if (@available(macOS 14.0, *)) {
            if (!CGPreflightScreenCaptureAccess()) return failure(@"Screen recording permission is not granted. Enable it in System Settings, then relaunch if required.");
            SCShareableContent *content = shareable();
            if (!content) return failure(@"Could not list available windows");
            NSMutableArray *windows = [NSMutableArray array];
            for (SCWindow *window in content.windows) {
                if (!eligible(window)) continue;
                SCRunningApplication *owner = window.owningApplication;
                [windows addObject:@{@"id":@(window.windowID), @"pid":@(owner.processID),
                    @"bundle":owner.bundleIdentifier, @"app":bounded(owner.applicationName, 80),
                    @"title":bounded(window.title, 100)}];
                if (windows.count >= 40) break;
            }
            return json_result(@{@"windows":windows});
        }
        return failure(@"Window capture requires macOS 14 or newer");
    }
}

// Use ScreenCaptureKit eligible windows joined with WindowServer z-order.
// Ignore transient / tiny auxiliary windows instead of treating the first
// layer-zero entry as the user's document.
static SCWindow *foreground_choice(SCShareableContent *content, uint32_t wid, int32_t pid, NSString *bundle) API_AVAILABLE(macos(14.0)) {
    pid_t active = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    if (active <= 0 || active == getpid() || (wid && active != pid)) return nil;
    CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly |
        kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (!raw) return nil;
    NSArray *ordered = CFBridgingRelease(raw);
    for (NSDictionary *info in ordered) {
        if ([info[(__bridge NSString *)kCGWindowOwnerPID] intValue] != active) continue;
        uint32_t candidate = [info[(__bridge NSString *)kCGWindowNumber] unsignedIntValue];
        for (SCWindow *window in content.windows) {
            if (window.windowID != candidate || window.owningApplication.processID != active || !eligible(window)) continue;
            if (wid && (candidate != wid || ![window.owningApplication.bundleIdentifier isEqualToString:bundle])) return nil;
            return window;
        }
    }
    return nil;
}

char *oplyra_screen_capture(uint32_t wid, int32_t pid, const char *bundle_utf8) {
    @autoreleasepool {
        if (@available(macOS 14.0, *)) {
            if (!CGPreflightScreenCaptureAccess()) return failure(@"Screen recording permission was revoked");
            NSString *bundle = [NSString stringWithUTF8String:bundle_utf8];
            if (wid && !allowed_bundle(bundle)) return failure(@"Window application is not supported");
            SCShareableContent *content = shareable();
            if (!content) return failure(@"Could not inspect selected window");
            SCWindow *selected = foreground_choice(content, wid, pid, bundle);
            if (!selected) return json_result(@{@"inactive":@YES});
            NSString *title = selected.title ?: @"";
            NSString *lower = title.lowercaseString;
            for (NSString *sensitive in @[@"password", @"sign in", @"log in", @"login", @"incognito", @"private browsing", @"online banking", @"passwort", @"anmelden"]) {
                if ([lower containsString:sensitive]) return json_result(@{@"inactive":@YES});
            }
            pid_t capturedPID = selected.owningApplication.processID;
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
            SCStreamConfiguration *configuration = [SCStreamConfiguration new];
            CGSize size = selected.frame.size;
            double scale = fmin(2.0, 2560.0 / fmax(size.width, size.height));
            configuration.width = (size_t)fmax(1.0, floor(size.width * scale));
            configuration.height = (size_t)fmax(1.0, floor(size.height * scale));
            configuration.showsCursor = NO;
            configuration.ignoreShadowsSingleWindow = YES;
            dispatch_semaphore_t done = dispatch_semaphore_create(0);
            // ARC retains the borrowed image in a block-owned object. A late
            // callback after timeout cannot access a caller-owned pointer.
            __block id captured = nil;
            [SCScreenshotManager captureImageWithFilter:filter configuration:configuration
                completionHandler:^(CGImageRef image, NSError *error) {
                    if (image && !error) captured = (__bridge id)image;
                    dispatch_semaphore_signal(done);
                }];
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 6 * NSEC_PER_SEC)) || !captured)
                return failure(@"Selected window capture did not complete");
            if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != capturedPID) return json_result(@{@"inactive":@YES});
            VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
            request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
            request.usesLanguageCorrection = YES;
            request.recognitionLanguages = @[@"en-US", @"de-DE"];
            VNImageRequestHandler *handler = [[VNImageRequestHandler alloc]
                initWithCGImage:(__bridge CGImageRef)captured options:@{}];
            NSError *error = nil;
            if (![handler performRequests:@[request] error:&error]) return failure(@"Local text recognition failed");
            // Prefer a reliable window title and top-to-bottom reading order.
            NSMutableString *text = [NSMutableString string];
            if (title.length) [text appendFormat:@"Window: %@\n", bounded(title, 160)];
            NSArray *ordered = [request.results sortedArrayUsingComparator:^NSComparisonResult(VNRecognizedTextObservation *a, VNRecognizedTextObservation *b) {
                double ay = floor(CGRectGetMidY(a.boundingBox) / 0.015), by = floor(CGRectGetMidY(b.boundingBox) / 0.015);
                if (ay != by) return ay > by ? NSOrderedAscending : NSOrderedDescending;
                double ax = CGRectGetMinX(a.boundingBox), bx = CGRectGetMinX(b.boundingBox);
                return ax < bx ? NSOrderedAscending : ax > bx ? NSOrderedDescending : NSOrderedSame;
            }];
            for (VNRecognizedTextObservation *observation in ordered) {
                VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
                if (!candidate || candidate.confidence < 0.75) continue;
                if (text.length) [text appendString:@"\n"];
                [text appendString:bounded(candidate.string, 600)];
                if (text.length >= 600) break;
            }
            if (NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier != capturedPID) return json_result(@{@"inactive":@YES});
            return json_result(@{@"text":bounded(text, 600)});
        }
        return failure(@"Window capture requires macOS 14 or newer");
    }
}


// Metadata only: no pixel capture, OCR, browser extensions or URLs.
// Cheap local foreground check. No browser metadata or content.
int32_t oplyra_chrome_foreground_pid(void) {
    @autoreleasepool {
        NSRunningApplication *active = NSWorkspace.sharedWorkspace.frontmostApplication;
        if ([active.bundleIdentifier isEqualToString:@"com.google.Chrome"]) return active.processIdentifier;
        return 0;
    }
}

@interface OplyraCuePanel : NSPanel
@end
@implementation OplyraCuePanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end
@interface OplyraCueView : NSView
@property(nonatomic, copy) NSString *message;
@property(nonatomic) NSInteger side;
@end
@implementation OplyraCueView
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirtyRect {
    (void)dirtyRect;
    NSRect rect = NSInsetRect(self.bounds, 5, 5);
    if (self.side == -1) rect.size.width -= 10;
    else if (self.side == 1) { rect.origin.x += 10; rect.size.width -= 10; }
    else rect.size.height -= 10;
    NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:rect xRadius:15 yRadius:15];
    CGFloat edge = self.side == -1 ? NSMaxX(rect) : NSMinX(rect);
    CGFloat cy = NSMidY(rect);
    NSBezierPath *tail = [NSBezierPath bezierPath];
    if (self.side != 0) {
        [tail moveToPoint:NSMakePoint(edge + (self.side == -1 ? -2 : 2), cy - 8)];
        [tail lineToPoint:NSMakePoint(edge + (self.side == -1 ? 10 : -10), cy + 6)];
        [tail lineToPoint:NSMakePoint(edge + (self.side == -1 ? -2 : 2), cy + 12)];
    } else {
        [tail moveToPoint:NSMakePoint(NSMidX(rect)-9, NSMaxY(rect)-2)];
        [tail lineToPoint:NSMakePoint(NSMidX(rect), NSMaxY(rect)+10)];
        [tail lineToPoint:NSMakePoint(NSMidX(rect)+9, NSMaxY(rect)-2)];
    }
    [tail closePath];
    [[NSColor colorWithSRGBRed:.83 green:.77 blue:.95 alpha:1] setStroke];
    [path setLineWidth:1]; [path stroke];
    [[NSColor colorWithSRGBRed:.98 green:.96 blue:1 alpha:.98] setFill];
    [path fill]; [tail fill];
    NSMutableParagraphStyle *style = [NSMutableParagraphStyle new];
    style.lineBreakMode = NSLineBreakByWordWrapping;
    NSDictionary *attrs = @{NSFontAttributeName:[NSFont systemFontOfSize:13 weight:NSFontWeightSemibold],
       NSForegroundColorAttributeName:[NSColor colorWithSRGBRed:.27 green:.22 blue:.39 alpha:1],
       NSParagraphStyleAttributeName:style};
    [self.message drawWithRect:NSInsetRect(rect, 13, 11)
       options:NSStringDrawingUsesLineFragmentOrigin | NSStringDrawingUsesFontLeading attributes:attrs];
}
@end
static OplyraCuePanel *cue_panel = nil;
static uint64_t cue_epoch = 0;
void oplyra_dismiss_focus_cue(void) {
    ++cue_epoch;
    if (cue_panel) { [cue_panel orderOut:nil]; [cue_panel close]; cue_panel = nil; }
}
int oplyra_show_focus_cue(void *raw_anchor, int kind) {
    @autoreleasepool {
        if (![NSThread isMainThread] || !raw_anchor) return 0;
        NSWindow *anchor = (__bridge NSWindow *)raw_anchor;
        if (!anchor.isVisible || !anchor.screen || anchor.frame.size.width > 240) return 0;
        oplyra_dismiss_focus_cue();
        NSRect a = anchor.frame, area = anchor.screen.visibleFrame;
        CGFloat width = MIN(235, area.size.width - 12), height = 72;
        if (width < 150 || area.size.height < height + 12) return 0;
        NSInteger side = -1;
        CGFloat x = NSMinX(a) - width + 10;
        CGFloat y = NSMidY(a) + 10;
        if (x < NSMinX(area)+4) { side = 1; x = NSMaxX(a)-10; }
        if (x + width > NSMaxX(area)-4) {
            side = 0; x = NSMidX(a)-width/2; y = NSMaxY(a)-4;
        }
        x = MAX(NSMinX(area)+4, MIN(x, NSMaxX(area)-width-4));
        y = MAX(NSMinY(area)+4, MIN(y, NSMaxY(area)-height-4));
        OplyraCuePanel *panel = [[OplyraCuePanel alloc] initWithContentRect:NSMakeRect(x,y,width,height)
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        panel.releasedWhenClosed = NO;
        panel.opaque = NO; panel.backgroundColor = NSColor.clearColor;
        panel.hasShadow = NO; panel.ignoresMouseEvents = YES;
        panel.hidesOnDeactivate = NO; panel.floatingPanel = YES;
        panel.excludedFromWindowsMenu = YES;
        panel.collectionBehavior = NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;
        panel.level = anchor.level + 1;
        OplyraCueView *view = [[OplyraCueView alloc] initWithFrame:NSMakeRect(0,0,width,height)];
        view.side = side;
        view.message = kind == 2 ? @"Focus tab set. I’ll keep you on track." : kind == 3 ? @"Hi! Your reminder bubble works." : kind == 1 ? @"Hey, switched tabs. Back to your focus?" : @"Hey, still on your task? Ready to get back to it?";
        panel.contentView = view;
        cue_panel = panel;
        [panel orderFrontRegardless];
        uint64_t epoch = cue_epoch;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            if (epoch == cue_epoch) oplyra_dismiss_focus_cue();
        });
        return 1;
    }
}
