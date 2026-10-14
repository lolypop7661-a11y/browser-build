using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Automation;

// A deliberately small bridge to Proton's own Connect control. It does not
// launch applications, select servers, inspect account fields, or change auth.
internal static class ProtonConnect
{
    private const string ProcessImage = "ProtonVPN.Client.exe";
    private const string CardId = "ConnectionCardComponent";
    private const string ConnectId = "ConnectionCardConnectButton";
    private const string CancelId = "ConnectionCardCancelButton";
    private const string DisconnectId = "ConnectionCardDisconnectButton";
    private const int PollMilliseconds = 200;
    private const int PollDeadlineMilliseconds = 10000;
    private static readonly object OutputLock = new object();
    private static bool outputWritten;

    private enum CardState { Waiting, Ready, Connected, Connecting, Ambiguous, Unsafe }

    private sealed class Marker
    {
        internal string Id;
        internal bool Visible;
        internal bool Enabled;
        internal bool Button;
        internal bool SameProcess;
        internal AutomationElement Element;
    }

    private sealed class Observation
    {
        internal CardState State;
        internal AutomationElement Button;
        internal IntPtr Window;
    }

    [MTAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
        int pid;
        if (args.Length != 2 || (args[0] != "--probe" && args[0] != "--connect") ||
            !Int32.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid <= 0)
        {
            Emit(false, "invalid-request", "Expected --probe or --connect followed by one process ID.");
            return 2;
        }

        // UI Automation providers can block. The parent also imposes a 15s
        // process timeout; this independent guard prevents a late invocation.
        using (var watchdog = new Timer(delegate
        {
            Emit(false, "manual-required", "Proton VPN did not respond in time. Use its Connect button directly.");
            Environment.Exit(2);
        }, null, 12000, Timeout.Infinite))
        {
            bool invocationAttempted = false;
            try
            {
                using (var process = Process.GetProcessById(pid))
                {
                    long startTime = process.StartTime.ToUniversalTime().Ticks;
                    if (!ValidateProcess(process, startTime))
                    {
                        Emit(false, "manual-required", "The target is not an accessible Proton VPN app in this Windows session.");
                        return 0;
                    }
                    var elapsed = Stopwatch.StartNew();
                    while (elapsed.ElapsedMilliseconds < PollDeadlineMilliseconds)
                    {
                        if (process.HasExited || !SameStartTime(process, startTime)) break;
                        Observation view = Observe(pid);
                        if (view.State == CardState.Connected)
                        {
                            Emit(true, "already-connected", "Proton VPN reports an active connection.");
                            return 0;
                        }
                        if (view.State == CardState.Connecting)
                        {
                            Emit(true, "connecting", "Proton VPN is already connecting. No additional action was requested.");
                            return 0;
                        }
                        if (view.State == CardState.Ambiguous || view.State == CardState.Unsafe)
                        {
                            Emit(false, "manual-required", "Proton VPN has an ambiguous or blocked window. Use its Connect button directly.");
                            return 0;
                        }
                        if (view.State == CardState.Ready)
                        {
                            if (args[0] == "--probe")
                            {
                                Emit(true, "ready", "Proton VPN is ready to receive a connection request.");
                                return 0;
                            }

                            // Recheck both identity and UI immediately before the
                            // sole permitted mutation. Never invoke Cancel or Disconnect.
                            if (elapsed.ElapsedMilliseconds >= PollDeadlineMilliseconds || !ValidateProcess(process, startTime)) break;
                            Observation latest = Observe(pid);
                            object pattern;
                            if (latest.State != CardState.Ready || latest.Window != view.Window ||
                                latest.Button == null || elapsed.ElapsedMilliseconds >= PollDeadlineMilliseconds ||
                                !latest.Button.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) break;
                            AutomationElement.AutomationElementInformation info = latest.Button.Current;
                            if (info.ProcessId != pid || info.AutomationId != ConnectId || info.ControlType != ControlType.Button ||
                                !info.IsEnabled || !IsVisible(info) || !SameStartTime(process, startTime) ||
                                elapsed.ElapsedMilliseconds >= PollDeadlineMilliseconds) break;
                            invocationAttempted = true;
                            ((InvokePattern)pattern).Invoke();
                            Emit(true, "requested", "Connect was requested in Proton VPN. Confirm the connection in Proton VPN.");
                            return 0;
                        }
                        if (args[0] == "--probe") break;
                        Thread.Sleep(PollMilliseconds);
                    }
                }
            }
            catch
            {
                // Do not expose process paths, account text, or provider details.
            }
            Emit(false, "manual-required", invocationAttempted
                ? "The connection request could not be confirmed. Check Proton VPN directly before trying again."
                : "Open Proton VPN and use its Connect button. Browsery did not request a connection.");
            return 0;
        }
    }

    private static bool SameStartTime(Process process, long expected)
    {
        try { return !process.HasExited && process.StartTime.ToUniversalTime().Ticks == expected; }
        catch { return false; }
    }

    private static bool ValidateProcess(Process process, long startTime)
    {
        using (var self = Process.GetCurrentProcess())
            if (!SameStartTime(process, startTime) || process.Id == self.Id || process.SessionId != self.SessionId) return false;
        IntPtr handle = OpenProcess(0x1000, false, process.Id); // QueryLimitedInformation only.
        if (handle == IntPtr.Zero) return false;
        IntPtr token = IntPtr.Zero;
        try
        {
            var image = new StringBuilder(32768);
            int size = image.Capacity;
            if (!QueryFullProcessImageName(handle, 0, image, ref size) ||
                !String.Equals(Path.GetFileName(image.ToString()), ProcessImage, StringComparison.OrdinalIgnoreCase)) return false;
            if (!OpenProcessToken(handle, 0x0008, out token)) return false; // TOKEN_QUERY only.
            using (var target = new WindowsIdentity(token))
            using (var current = WindowsIdentity.GetCurrent())
            {
                return target.User != null && current.User != null && target.User.Equals(current.User) && SameStartTime(process, startTime);
            }
        }
        finally
        {
            if (token != IntPtr.Zero) CloseHandle(token);
            CloseHandle(handle);
        }
    }

    private static Observation Observe(int pid)
    {
        var windows = VisibleWindows(pid);
        if (windows.Count == 0) return new Observation { State = CardState.Waiting };
        if (windows.Count != 1 || !IsWindowEnabled(windows[0])) return new Observation { State = CardState.Ambiguous };
        AutomationElement window = AutomationElement.FromHandle(windows[0]);
        if (window == null || window.Current.ProcessId != pid || !window.Current.IsEnabled || !IsVisible(window.Current))
            return new Observation { State = CardState.Unsafe };

        object windowPattern;
        if (window.TryGetCurrentPattern(WindowPattern.Pattern, out windowPattern) && ((WindowPattern)windowPattern).Current.IsModal)
            return new Observation { State = CardState.Unsafe };
        // Only window metadata is inspected here; account/settings field values
        // and names are never read or searched.
        AutomationElementCollection childWindows = window.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window));
        foreach (AutomationElement child in childWindows)
            if (IsVisible(child.Current) && child.TryGetCurrentPattern(WindowPattern.Pattern, out windowPattern) &&
                ((WindowPattern)windowPattern).Current.IsModal) return new Observation { State = CardState.Unsafe };

        AutomationElementCollection foundCards = window.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, CardId));
        var cards = new List<AutomationElement>();
        foreach (AutomationElement card in foundCards)
        {
            AutomationElement.AutomationElementInformation info = card.Current;
            if (!IsVisible(info)) continue;
            if (info.ProcessId != pid) return new Observation { State = CardState.Unsafe };
            cards.Add(card);
        }
        if (cards.Count == 0) return new Observation { State = CardState.Waiting };
        if (cards.Count != 1) return new Observation { State = CardState.Ambiguous };
        if (!cards[0].Current.IsEnabled) return new Observation { State = CardState.Waiting };

        Condition markerCondition = new OrCondition(
            new PropertyCondition(AutomationElement.AutomationIdProperty, ConnectId),
            new PropertyCondition(AutomationElement.AutomationIdProperty, CancelId),
            new PropertyCondition(AutomationElement.AutomationIdProperty, DisconnectId));
        AutomationElementCollection foundMarkers = cards[0].FindAll(TreeScope.Descendants, markerCondition);
        var markers = new List<Marker>();
        foreach (AutomationElement element in foundMarkers)
        {
            AutomationElement.AutomationElementInformation info = element.Current;
            markers.Add(new Marker { Id = info.AutomationId, Visible = IsVisible(info), Enabled = info.IsEnabled,
                Button = info.ControlType == ControlType.Button, SameProcess = info.ProcessId == pid, Element = element });
        }
        CardState state = EvaluateMarkers(markers);
        AutomationElement connect = null;
        if (state == CardState.Ready)
            foreach (Marker marker in markers)
                if (marker.Visible && marker.Enabled && marker.Button && marker.SameProcess && marker.Id == ConnectId) connect = marker.Element;
        return new Observation { State = state, Button = connect, Window = windows[0] };
    }

    // Pure matching policy, shared with --self-test. Multiple active controls
    // are rejected instead of guessing a state or using a visual fallback.
    private static CardState EvaluateMarkers(IList<Marker> markers)
    {
        Marker active = null;
        foreach (Marker marker in markers)
        {
            if (!marker.Visible) continue;
            if (!marker.SameProcess || !marker.Button) return CardState.Unsafe;
            if (!marker.Enabled) continue;
            if (active != null) return CardState.Ambiguous;
            active = marker;
        }
        if (active == null) return CardState.Waiting;
        if (active.Id == ConnectId) return CardState.Ready;
        if (active.Id == CancelId) return CardState.Connecting;
        if (active.Id == DisconnectId) return CardState.Connected;
        return CardState.Unsafe;
    }

    private static bool IsVisible(AutomationElement.AutomationElementInformation info)
    {
        var bounds = info.BoundingRectangle;
        return !info.IsOffscreen && !bounds.IsEmpty && bounds.Width > 0 && bounds.Height > 0 &&
            !Double.IsInfinity(bounds.Width) && !Double.IsInfinity(bounds.Height);
    }

    private static List<IntPtr> VisibleWindows(int pid)
    {
        var result = new List<IntPtr>();
        EnumWindows(delegate(IntPtr window, IntPtr unused)
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == (uint)pid && IsWindowVisible(window)) result.Add(window);
            return true;
        }, IntPtr.Zero);
        return result;
    }

    private static Marker TestMarker(string id, bool visible = true, bool enabled = true, bool button = true, bool sameProcess = true)
    {
        return new Marker { Id = id, Visible = visible, Enabled = enabled, Button = button, SameProcess = sameProcess };
    }

    private static int SelfTest()
    {
        bool passed = EvaluateMarkers(new Marker[0]) == CardState.Waiting &&
            EvaluateMarkers(new[] { TestMarker(ConnectId) }) == CardState.Ready &&
            EvaluateMarkers(new[] { TestMarker(CancelId) }) == CardState.Connecting &&
            EvaluateMarkers(new[] { TestMarker(DisconnectId) }) == CardState.Connected &&
            EvaluateMarkers(new[] { TestMarker(ConnectId, true, false) }) == CardState.Waiting &&
            EvaluateMarkers(new[] { TestMarker(ConnectId), TestMarker(DisconnectId, false) }) == CardState.Ready &&
            EvaluateMarkers(new[] { TestMarker(ConnectId), TestMarker(ConnectId) }) == CardState.Ambiguous &&
            EvaluateMarkers(new[] { TestMarker(ConnectId), TestMarker(DisconnectId) }) == CardState.Ambiguous &&
            EvaluateMarkers(new[] { TestMarker(ConnectId, true, true, false) }) == CardState.Unsafe &&
            EvaluateMarkers(new[] { TestMarker(ConnectId, true, true, true, false) }) == CardState.Unsafe &&
            EvaluateMarkers(new[] { TestMarker("Unknown") }) == CardState.Unsafe;
        Emit(passed, passed ? "self-test-passed" : "self-test-failed", passed ? "Matching policy passed 11 isolated checks. No Windows UI was accessed." : "Matching policy checks failed.");
        return passed ? 0 : 1;
    }

    private static void Emit(bool ok, string status, string message)
    {
        lock (OutputLock)
        {
            if (outputWritten) return;
            outputWritten = true;
            Console.Out.WriteLine("{\"ok\":" + (ok ? "true" : "false") + ",\"status\":\"" + Escape(status) + "\",\"message\":\"" + Escape(message) + "\"}");
            Console.Out.Flush();
        }
    }

    private static string Escape(string text)
    {
        return text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
