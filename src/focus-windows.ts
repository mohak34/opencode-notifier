import { execFileSync } from "child_process"

// Raw window state from the PowerShell probe. Handles are HWND values.
export interface WindowsFocusFacts {
  foreground: number
  // False when OpenCode's process has no console to attach to.
  attached: boolean
  consoleWindow: number
  // GA_ROOTOWNER of the console window. Windows Terminal owns its ConPTY window.
  consoleOwner: number
  consoleVisible: boolean
  // OpenCode's parent chain, nearest first, with each process's visible,
  // unowned, non-tool top-level windows.
  ancestors: { pid: number; name: string; windows: number[] }[]
}

export interface WindowsFocusDecision {
  focused: boolean
  reason: string
}

// Suppress only when the window hosting OpenCode is provably in front.
// Every uncertain case returns focused=false so the alert is delivered.
export function decideWindowsFocus(facts: WindowsFocusFacts): WindowsFocusDecision {
  if (!facts.foreground) return { focused: false, reason: "no foreground window" }
  // Without OpenCode's console the ancestor walk has nothing tying it to a
  // terminal, so an unrelated launcher window could pass as the host.
  if (!facts.attached) return { focused: false, reason: "console attach failed" }

  const { consoleWindow, consoleOwner } = facts
  if (consoleOwner && consoleOwner !== consoleWindow) {
    return { focused: facts.foreground === consoleOwner, reason: "console owner window" }
  }
  if (consoleWindow && facts.consoleVisible) {
    return { focused: facts.foreground === consoleWindow, reason: "console window" }
  }

  // Unowned ConPTY (VS Code, WezTerm, Alacritty): the host is the nearest
  // ancestor with a window, and only counts if that window is unambiguous.
  const host = facts.ancestors.find(ancestor => ancestor.windows.length > 0)
  if (!host) return { focused: false, reason: "no host window" }
  if (host.name.toLowerCase() === "explorer.exe") return { focused: false, reason: "host is explorer" }
  if (host.windows.length !== 1) {
    return { focused: false, reason: `host ${host.name} has ${host.windows.length} windows` }
  }
  return { focused: facts.foreground === host.windows[0], reason: `host ${host.name}` }
}

function isHandle(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

// The probe prints one compressed JSON object; PowerShell may add CLIXML or
// warning lines around it. Returns null for anything that is not that object.
export function parseWindowsFocusFacts(output: string | null): WindowsFocusFacts | null {
  const line = output?.split(/\r?\n/).map(value => value.trim()).find(value => value.startsWith("{"))
  if (!line) return null
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const facts = value as Record<string, unknown>
  if (!isHandle(facts.foreground) || !isHandle(facts.consoleWindow) || !isHandle(facts.consoleOwner)) return null
  if (typeof facts.attached !== "boolean" || typeof facts.consoleVisible !== "boolean") return null
  if (!Array.isArray(facts.ancestors)) return null
  const ancestors: WindowsFocusFacts["ancestors"] = []
  for (const entry of facts.ancestors) {
    if (typeof entry !== "object" || entry === null) return null
    const { pid, name, windows } = entry as Record<string, unknown>
    if (!isHandle(pid) || typeof name !== "string" || !Array.isArray(windows) || !windows.every(isHandle)) return null
    ancestors.push({ pid, name, windows })
  }
  return {
    foreground: facts.foreground,
    attached: facts.attached,
    consoleWindow: facts.consoleWindow,
    consoleOwner: facts.consoleOwner,
    consoleVisible: facts.consoleVisible,
    ancestors,
  }
}

// C# stays within C# 5 so Windows PowerShell 5.1's compiler accepts it.
const PROBE_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace OpenCodeNotifier {
  public class Ancestor {
    public uint pid;
    public string name;
    public long[] windows;
  }

  public class Facts {
    public long foreground;
    public bool attached;
    public long consoleWindow;
    public long consoleOwner;
    public bool consoleVisible;
    public Ancestor[] ancestors;
  }

  public static class FocusProbe {
    const uint GA_ROOTOWNER = 3;
    const uint GW_OWNER = 4;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x80;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint TH32CS_SNAPPROCESS = 2;
    const int MAX_DEPTH = 32;

    delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry {
      public uint size;
      public uint usage;
      public uint processId;
      public IntPtr defaultHeapId;
      public uint moduleId;
      public uint threads;
      public uint parentProcessId;
      public int priorityBase;
      public uint flags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exeFile;
    }

    [DllImport("kernel32.dll")] static extern bool FreeConsole();
    [DllImport("kernel32.dll")] static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    // Zero when the process cannot be opened.
    static long StartTime(uint processId) {
      IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
      if (process == IntPtr.Zero) return 0;
      try {
        long creation, exit, kernel, user;
        return GetProcessTimes(process, out creation, out exit, out kernel, out user) ? creation : 0;
      } finally {
        CloseHandle(process);
      }
    }

    public static Facts Probe(uint processId) {
      Facts facts = new Facts();
      facts.foreground = GetForegroundWindow().ToInt64();

      FreeConsole();
      facts.attached = AttachConsole(processId);
      if (facts.attached) {
        IntPtr console = GetConsoleWindow();
        facts.consoleWindow = console.ToInt64();
        if (console != IntPtr.Zero) {
          facts.consoleOwner = GetAncestor(console, GA_ROOTOWNER).ToInt64();
          facts.consoleVisible = IsWindowVisible(console);
        }
        FreeConsole();
      }

      // The callback never stops early, so false means the list is incomplete.
      // Throwing ends the script before any JSON is printed, which fails open.
      Dictionary<uint, List<long>> windowsByProcess = new Dictionary<uint, List<long>>();
      bool enumerated = EnumWindows(delegate (IntPtr window, IntPtr parameter) {
        if (!IsWindowVisible(window) || GetWindow(window, GW_OWNER) != IntPtr.Zero) return true;
        if ((GetWindowLong(window, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        List<long> list;
        if (!windowsByProcess.TryGetValue(owner, out list)) {
          list = new List<long>();
          windowsByProcess[owner] = list;
        }
        list.Add(window.ToInt64());
        return true;
      }, IntPtr.Zero);
      if (!enumerated) throw new InvalidOperationException("EnumWindows failed");

      Dictionary<uint, ProcessEntry> processes = new Dictionary<uint, ProcessEntry>();
      IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
      if (snapshot != new IntPtr(-1)) {
        try {
          ProcessEntry entry = new ProcessEntry();
          entry.size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
          for (bool more = Process32FirstW(snapshot, ref entry); more; more = Process32NextW(snapshot, ref entry)) {
            processes[entry.processId] = entry;
          }
        } finally {
          CloseHandle(snapshot);
        }
      }

      List<Ancestor> ancestors = new List<Ancestor>();
      HashSet<uint> seen = new HashSet<uint>();
      ProcessEntry current;
      uint id = processId;
      long childStart = StartTime(id);
      while (ancestors.Count < MAX_DEPTH && seen.Add(id) && processes.TryGetValue(id, out current)) {
        id = current.parentProcessId;
        ProcessEntry parent;
        if (id == 0 || !processes.TryGetValue(id, out parent)) break;
        // A parent that exited leaves its id free for reuse by an unrelated
        // process. Stop unless the parent provably started before the child.
        long parentStart = StartTime(id);
        if (childStart == 0 || parentStart == 0 || parentStart > childStart) break;
        childStart = parentStart;
        List<long> windows;
        Ancestor ancestor = new Ancestor();
        ancestor.pid = id;
        ancestor.name = parent.exeFile;
        ancestor.windows = windowsByProcess.TryGetValue(id, out windows) ? windows.ToArray() : new long[0];
        ancestors.Add(ancestor);
      }
      facts.ancestors = ancestors.ToArray();
      return facts;
    }
  }
}
`

// Errors stop the script before any JSON is printed, which fails open.
export function buildWindowsFocusScript(pid: number): string {
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${PROBE_SOURCE.trim()}
'@
[OpenCodeNotifier.FocusProbe]::Probe(${pid}) | ConvertTo-Json -Compress -Depth 5`
}

function runPowerShell(command: string, script: string): string | null {
  try {
    const encoded = Buffer.from(script, "utf16le").toString("base64")
    return execFileSync(command, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      timeout: 5000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim()
  } catch {
    return null
  }
}

// Probes and decides for the current process. Detail is for debug logging.
export function getWindowsFocus(): WindowsFocusDecision & { output: string | null } {
  const script = buildWindowsFocusScript(process.pid)
  const output = runPowerShell("powershell", script) ?? runPowerShell("pwsh", script)
  const facts = parseWindowsFocusFacts(output)
  const decision = facts ? decideWindowsFocus(facts) : { focused: false, reason: "probe failed" }
  return { ...decision, output }
}
