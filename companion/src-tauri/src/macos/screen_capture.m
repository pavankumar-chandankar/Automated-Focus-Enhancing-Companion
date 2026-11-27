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
            pid_t capturedPID = selected.owningApplication.processID;
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
            SCStreamConfiguration *configuration = [SCStreamConfiguration new];
            CGSize size = selected.frame.size;
            double scale = fmin(1.0, 1440.0 / fmax(size.width, size.height));
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
            request.recognitionLevel = VNRequestTextRecognitionLevelFast;
            request.usesLanguageCorrection = NO;
            request.recognitionLanguages = @[@"en-US", @"de-DE"];
            VNImageRequestHandler *handler = [[VNImageRequestHandler alloc]
                initWithCGImage:(__bridge CGImageRef)captured options:@{}];
            NSError *error = nil;
            if (![handler performRequests:@[request] error:&error]) return failure(@"Local text recognition failed");
            NSMutableString *text = [NSMutableString string];
            for (VNRecognizedTextObservation *observation in request.results) {
                VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
                if (!candidate || candidate.confidence < 0.5) continue;
                if (text.length) [text appendString:@"\n"];
                [text appendString:bounded(candidate.string, 600)];
                if (text.length >= 600) break;
            }
            return json_result(@{@"text":bounded(text, 600)});
        }
        return failure(@"Window capture requires macOS 14 or newer");
    }
}
