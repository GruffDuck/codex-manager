import AppKit
import Foundation

let bundleID = "com.openai.codex"
func output(_ value: [String: Any], code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    exit(code)
}
func running() -> [NSRunningApplication] {
    return NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).filter { !$0.isTerminated }
}
let command = CommandLine.arguments.dropFirst().first ?? "status"
let apps = running()
let url = apps.first?.bundleURL ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
guard let applicationURL = url else {
    output(["ok": false, "error": "Codex is not installed."], code: 2)
}
guard Bundle(url: applicationURL)?.bundleIdentifier == bundleID else {
    output(["ok": false, "error": "Codex application identity could not be checked."], code: 2)
}
switch command {
case "status":
    output(["ok": true, "installed": true, "running": !apps.isEmpty,
            "pids": apps.map { Int($0.processIdentifier) }, "path": applicationURL.path])
case "quit":
    for app in apps {
        if !app.terminate() { output(["ok": false, "error": "Codex did not accept the quit request."], code: 3) }
    }
    let deadline = Date().addingTimeInterval(25)
    while !running().isEmpty && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    guard running().isEmpty else {
        output(["ok": false, "error": "Codex has not finished quitting. No force quit was attempted."], code: 3)
    }
    output(["ok": true, "running": false])
case "launch":
    guard CommandLine.arguments.count == 3 else {
        output(["ok": false, "error": "A Codex profile directory is required."], code: 2)
    }
    guard running().isEmpty else {
        output(["ok": false, "error": "Codex was reopened elsewhere before the switch finished."], code: 3)
    }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    config.environment = ["CODEX_HOME": CommandLine.arguments[2]]
    var finished = false
    var success = false
    NSWorkspace.shared.openApplication(at: applicationURL, configuration: config) { app, error in
        success = app != nil && error == nil
        finished = true
    }
    let deadline = Date().addingTimeInterval(20)
    while !finished && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    guard success && !running().isEmpty else {
        output(["ok": false, "error": "Codex could not be reopened."], code: 4)
    }
    output(["ok": true, "running": true, "pids": running().map { Int($0.processIdentifier) }])
default:
    output(["ok": false, "error": "Unsupported lifecycle command."], code: 2)
}
