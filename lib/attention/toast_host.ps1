param([switch]$PreviewMode, [int]$HoldSeconds = 0)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch { }

# Per-monitor DPI awareness so WPF layout units and Win32 pixels agree.
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DpiAwareness {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@ -ErrorAction Stop
  if (-not [DpiAwareness]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [void][DpiAwareness]::SetProcessDPIAware() }
} catch { }

# Raise the DSH window that owns this host process (issue #1): a renderer's
# window.focus() cannot restore a minimized window, so the native host does it
# right before it reports the click.
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OwnerWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] static extern bool Process32First(IntPtr snap, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] static extern bool Process32Next(IntPtr snap, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct PROCESSENTRY32 {
    public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
    public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }
  public static uint ParentOf(uint pid) {
    IntPtr snap = CreateToolhelp32Snapshot(0x00000002, 0);
    if (snap == new IntPtr(-1)) { return 0; }
    try {
      PROCESSENTRY32 entry = new PROCESSENTRY32();
      entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      if (!Process32First(snap, ref entry)) { return 0; }
      do { if (entry.th32ProcessID == pid) { return entry.th32ParentProcessID; } } while (Process32Next(snap, ref entry));
      return 0;
    } finally { CloseHandle(snap); }
  }
  public static string ExeNameOf(uint pid) {
    IntPtr snap = CreateToolhelp32Snapshot(0x00000002, 0);
    if (snap == new IntPtr(-1)) { return ""; }
    try {
      PROCESSENTRY32 entry = new PROCESSENTRY32();
      entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      if (!Process32First(snap, ref entry)) { return ""; }
      do { if (entry.th32ProcessID == pid) { return entry.szExeFile ?? ""; } } while (Process32Next(snap, ref entry));
      return "";
    } finally { CloseHandle(snap); }
  }
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll")] public static extern bool GetUserObjectInformation(IntPtr hObj, int index, System.Text.StringBuilder info, int length, out int needed);
}
"@ -ErrorAction Stop
} catch { }
# Async stdin reader: blocking reads on the dispatcher froze the timers.
try {
  Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Collections.Concurrent;
public static class StdinQueue {
  public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public static volatile bool Closed;
  private static Stream _s;
  private static readonly byte[] _buf = new byte[65536];
  private static readonly object _lock = new object();
  private static string _rem = "";
  public static void Start() {
    try { _s = Console.OpenStandardInput(); } catch { Closed = true; return; }
    try { _s.BeginRead(_buf, 0, _buf.Length, OnRead, null); } catch { Closed = true; }
  }
  private static void OnRead(IAsyncResult ar) {
    int n;
    try { n = _s.EndRead(ar); } catch { Closed = true; return; }
    if (n <= 0) { Closed = true; return; }
    lock (_lock) {
      _rem += Encoding.UTF8.GetString(_buf, 0, n);
      int i;
      while ((i = _rem.IndexOf('\n')) >= 0) {
        string line = _rem.Substring(0, i).Trim();
        _rem = _rem.Substring(i + 1);
        if (line.Length > 0) { Lines.Enqueue(line); }
      }
    }
    try { _s.BeginRead(_buf, 0, _buf.Length, OnRead, null); } catch { Closed = true; }
  }
}
"@ -ErrorAction Stop
} catch { }

$script:Config = @{
  locale = 'zh'
  width = 340
  durationMs = 8000
  maxVisible = 3
  colors = @{
    completed    = @{ bg = '#12351F'; fg = '#E6F4EA'; accent = '#2EA043' }
    failed       = @{ bg = '#3A1518'; fg = '#FBE9EA'; accent = '#D1242F' }
    question     = @{ bg = '#241A3D'; fg = '#EFE9FF'; accent = '#8250DF' }
    permission   = @{ bg = '#3A2A10'; fg = '#FFF4E0'; accent = '#BF8700' }
    sidelinedone = @{ bg = '#0D2A33'; fg = '#E3F6FB'; accent = '#1F8FB0' }
  }
}

$script:Kicker = @{
  zh = @{ completed = '任务完成'; failed = '任务出错'; question = '收到提问'; permission = '等待审批'; sidelinedone = '支线汇总' }
  en = @{ completed = 'Task completed'; failed = 'Task failed'; question = 'Question'; permission = 'Approval needed'; sidelinedone = 'Side-line batch' }
}

$script:Toasts = New-Object System.Collections.ArrayList
$script:OwnerPid = 0
$script:OwnerHwnd = [IntPtr]::Zero
$script:OwnerExe = ''
$script:OwnerExeName = ''
$script:Seq = 0
$script:Running = $true

function Write-Event($obj) {
  try {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
  } catch { }
}

function Get-WorkArea { return [System.Windows.SystemParameters]::WorkArea }

function Update-Layout {
  try {
    $wa = Get-WorkArea
    $y = $wa.Bottom - 20
    $items = @($script:Toasts | Sort-Object -Property Seq -Descending)
    foreach ($t in $items) {
      $h = if ($t.Win.ActualHeight -gt 10) { $t.Win.ActualHeight } else { 80 }
      $w = if ($t.Win.ActualWidth -gt 10) { $t.Win.ActualWidth } else { [double]$script:Config.width }
      $y = $y - $h
      $t.Win.Left = [Math]::Max($wa.Left, $wa.Right - $w - 20)
      $t.Win.Top = $y
      $y = $y - 10
    }
  } catch { }
}

# The window is owned by the Electron main process, which is an ancestor of
# this host, not the pid the plugin reports (that is the plugin-host child).
# Collect the ancestry of both and match any of them against the windows.
function Get-PidChain([int]$start) {
  $chain = New-Object System.Collections.Generic.List[int]
  $current = $start
  for ($i = 0; $i -lt 8 -and $current -gt 0; $i++) {
    $chain.Add($current)
    # Toolhelp, not WMI: a DSH child process cannot be assumed to have a
    # working WMI connection, and WMI failing here made the chain collapse to
    # this process alone, so no ancestor window was ever found.
    $parent = [int][OwnerWindow]::ParentOf([uint32]$current)
    if ($parent -le 0 -or $parent -eq $current) { break }
    $current = $parent
  }
  return $chain
}

# The window belongs to the Electron main process, an ancestor of this host,
# not to the pid the plugin reports (that is the plugin-host child). Walk both
# ancestries and keep the pids that run the same executable as the plugin host,
# so a shell or explorer window in the chain can never win the match.
function Get-OwnerPids {
  $set = @{}
  $ownerPid = [uint32]$script:OwnerPid
  $selfPid = [uint32]$PID
  # The host owns the toast cards; matching its own window would raise the card
  # instead of the application (skip own pid).
  foreach ($p in @((Get-PidChain $PID) + (Get-PidChain ([int]$script:OwnerPid)))) {
    if ([uint32]$p -eq $selfPid) { continue }
    if ($p -le 0) { continue }
    $candidate = [uint32]$p
    if ($candidate -eq $ownerPid) { $set[$candidate] = $true; continue }
    $wanted = if ($script:OwnerExeName -ne '') { $script:OwnerExeName } else { $script:OwnerExe }
    if ($wanted -eq '') { $set[$candidate] = $true; continue }
    $name = [string][OwnerWindow]::ExeNameOf($candidate)
    if ($name -ne '' -and ($name -ieq $wanted -or ($script:OwnerExe -ne '' -and (Split-Path -Leaf $script:OwnerExe) -ieq $name))) { $set[$candidate] = $true }
  }
  return $set
}
function Raise-OwnerWindow {
  $script:OwnerPidSet = Get-OwnerPids
  $script:OwnerMatchCount = 0
  $pids = $script:OwnerPidSet
  if ($pids.Count -eq 0) { return $false }
  $script:OwnerHwnd = [IntPtr]::Zero
  try {
    $callback = [OwnerWindow+EnumWindowsProc]{
      param([IntPtr]$hwnd, [IntPtr]$lparam)
      $windowPid = [uint32]0
      [void][OwnerWindow]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)
      if ($script:OwnerPidSet.ContainsKey($windowPid)) { $script:OwnerMatchCount = [int]$script:OwnerMatchCount + 1 }
      if ($script:OwnerPidSet.ContainsKey($windowPid) -and [OwnerWindow]::IsWindowVisible($hwnd) -and [OwnerWindow]::GetWindow($hwnd, 4) -eq [IntPtr]::Zero) {
        if ([OwnerWindow]::GetWindowTextLength($hwnd) -gt 0) { $script:OwnerHwnd = $hwnd; return $false }
        if ($script:OwnerHwnd -eq [IntPtr]::Zero) { $script:OwnerHwnd = $hwnd }
      }
      return $true
    }
    [void][OwnerWindow]::EnumWindows($callback, [IntPtr]::Zero)
  } catch { return $false }
  $hwnd = $script:OwnerHwnd
  if ($hwnd -eq [IntPtr]::Zero) { return $false }
  $script:RaiseDebug = ""
  try {
    $wasIconic = [OwnerWindow]::IsIconic($hwnd)
    # Standard Windows recipe for "restore + really take the foreground":
    # attach to the target UI thread and allow the foreground change, otherwise
    # Windows silently converts the activation into a taskbar flash.
    $procId = [uint32]0
    $targetThread = [OwnerWindow]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $currentThread = [OwnerWindow]::GetCurrentThreadId()
    [void][OwnerWindow]::AllowSetForegroundWindow(-1)
    [void][OwnerWindow]::AttachThreadInput($currentThread, $targetThread, $true)
    $shown = [OwnerWindow]::ShowWindow($hwnd, 9)
    if (-not $wasIconic) { [void][OwnerWindow]::ShowWindow($hwnd, 5) }
    $fg = [OwnerWindow]::SetForegroundWindow($hwnd)
    [void][OwnerWindow]::BringWindowToTop($hwnd)
    [void][OwnerWindow]::AttachThreadInput($currentThread, $targetThread, $false)
    if (-not $fg) { [OwnerWindow]::SwitchToThisWindow($hwnd, $true) }
    Start-Sleep -Milliseconds 60
    Start-Sleep -Milliseconds 120
    $script:RaiseDebug = "wasIconic=$wasIconic show=$shown fg=$fg nowIconic=" + [OwnerWindow]::IsIconic($hwnd)
    return $true
  } catch { $script:RaiseDebug = "error=" + $_.Exception.Message; return $false }
}
function Get-ToastById([string]$id) {
  foreach ($t in @($script:Toasts)) { if ($t.Id -eq $id) { return $t } }
  return $null
}

function Close-Toast($toast, [string]$reason) {
  if ($null -eq $toast -or $toast.Closed) { return }
  $toast.Closed = $true
  try { if ($toast.Timer) { $toast.Timer.Stop(); $toast.Timer = $null } } catch { }
  try { $toast.Win.Close() } catch { }
  [void]$script:Toasts.Remove($toast)
  Write-Event @{ event = 'closed'; id = $toast.Id; reason = $reason }
  Update-Layout
}

function Invoke-ToastClick([string]$id) {
  $t = Get-ToastById $id
  if ($null -eq $t -or $t.Closed) { return }
  $raised = $false
  try { $raised = [bool](Raise-OwnerWindow) } catch { $raised = $false }
  $pidList = @()
  if ($null -ne $script:OwnerPidSet) { $pidList = @($script:OwnerPidSet.Keys) }
  Write-Event @{ event = 'raise'; ok = $raised; hwnd = [string]$script:OwnerHwnd; matches = [int]$script:OwnerMatchCount; pids = $pidList; error = $($Error[0].Exception.Message); debug = [string]$script:RaiseDebug }
  Write-Event @{ event = 'clicked'; id = $t.Id }
  Close-Toast $t 'click'
}

function Start-Timer($toast) {
  if ($null -eq $toast -or $toast.Closed) { return }
  try { if ($toast.Timer) { $toast.Timer.Stop() } } catch { }
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds([Math]::Max(1500, [int]$toast.Duration))
  $timer.Add_Tick({
    param($sender, $e)
    try { $sender.Stop() } catch { }
    foreach ($cand in @($script:Toasts)) {
      if ($cand.Timer -eq $sender) { Close-Toast $cand 'timeout'; break }
    }
  })
  $toast.Timer = $timer
  $timer.Start()
}

function Show-Toast($payload) {
  $script:Seq = $script:Seq + 1
  $kind = [string]$payload.kind
  if (-not $script:Config.colors.ContainsKey($kind)) { $kind = 'completed' }
  $colors = $script:Config.colors[$kind]
  $locale = [string]$script:Config.locale
  if (-not $script:Kicker.ContainsKey($locale)) { $locale = 'zh' }

  $id = if ($payload.id) { [string]$payload.id } else { 't' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $duration = if ($payload.durationMs) { [int]$payload.durationMs } else { [int]$script:Config.durationMs }
  $title = [string]$payload.title
  $text = [string]$payload.text
  $kicker = if ($payload.kicker) { [string]$payload.kicker } else { $script:Kicker[$locale][$kind] }
  if ([string]::IsNullOrEmpty($title)) { $title = $kicker }

  $win = New-Object System.Windows.Window
  $win.WindowStyle = 'None'
  $win.AllowsTransparency = $false
  $win.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($colors.bg)))
  $win.ShowInTaskbar = $false
  $win.Topmost = $true
  $win.ShowActivated = $false
  $win.ResizeMode = 'NoResize'
  $win.SizeToContent = 'Manual'
  $win.Width = [double]$script:Config.width

  $card = New-Object System.Windows.Controls.Border
  $card.CornerRadius = New-Object System.Windows.CornerRadius 12
  $card.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($colors.bg)))
  $card.Padding = New-Object System.Windows.Thickness 14, 11, 12, 11

  $grid = New-Object System.Windows.Controls.Grid
  $grid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null
  $grid.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null
  $grid.ColumnDefinitions[0].Width = New-Object System.Windows.GridLength 4
  $grid.ColumnDefinitions[1].Width = New-Object System.Windows.GridLength 1, 'Star'

  $bar = New-Object System.Windows.Controls.Border
  $bar.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($colors.accent)))
  $bar.CornerRadius = New-Object System.Windows.CornerRadius 2
  $bar.Margin = New-Object System.Windows.Thickness 0, 2, 10, 2
  [System.Windows.Controls.Grid]::SetColumn($bar, 0)
  $grid.Children.Add($bar) | Out-Null

  $panel = New-Object System.Windows.Controls.StackPanel
  [System.Windows.Controls.Grid]::SetColumn($panel, 1)
  $grid.Children.Add($panel) | Out-Null

  $head = New-Object System.Windows.Controls.Grid
  $k = New-Object System.Windows.Controls.TextBlock
  $k.Text = $kicker.ToUpper()
  $k.FontSize = 10
  $k.FontWeight = 'Bold'
  $k.Foreground = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($colors.accent)))
  $head.Children.Add($k) | Out-Null

  $close = New-Object System.Windows.Controls.TextBlock
  $close.Text = [char]0x2715
  $close.FontSize = 15
  $close.HorizontalAlignment = 'Right'
  $close.Cursor = [System.Windows.Input.Cursors]::Hand
  $close.Foreground = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($colors.fg)))
  $close.Opacity = 0.9
  $head.Children.Add($close) | Out-Null
  $panel.Children.Add($head) | Out-Null

  $t = New-Object System.Windows.Controls.TextBlock
  $t.Text = $title
  $t.FontSize = 13.5
  $t.FontWeight = 'Bold'
  $t.TextWrapping = 'Wrap'
  $t.Margin = New-Object System.Windows.Thickness 0, 3, 0, 0
  $t.Foreground = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($colors.fg)))
  $panel.Children.Add($t) | Out-Null

  if (-not [string]::IsNullOrEmpty($text)) {
    $b = New-Object System.Windows.Controls.TextBlock
    $b.Text = $text
    $b.FontSize = 12
    $b.TextWrapping = 'Wrap'
    $b.MaxHeight = 62
    $b.Margin = New-Object System.Windows.Thickness 0, 3, 0, 0
    $b.Foreground = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($colors.fg)))
    $b.Opacity = 0.92
    $panel.Children.Add($b) | Out-Null
  }

  $card.Child = $grid
  $win.Content = $card

  # Height: fixed conservative tiers (WPF measurement under-reports on scaled
  # displays); the body is clamped to three lines in the card itself.
  # Three-line card: fixed 132 px. WPF measurement under-reports on scaled
  # displays (125% here), and a taller card is better than clipped text.
  $win.Height = if ([string]::IsNullOrEmpty($text)) { 96 } else { 132 }

  $toast = [pscustomobject]@{
    Id = $id; Win = $win; Timer = $null; Closed = $false; Seq = $script:Seq; Duration = $duration
  }

  $win.Tag = $id
  $card.Tag = $id
  $close.Tag = $id

  $card.Add_MouseLeftButtonUp({ param($sender, $e) Invoke-ToastClick ([string]$sender.Tag); $e.Handled = $true })
  $close.Add_MouseLeftButtonUp({ param($sender, $e) $t0 = Get-ToastById ([string]$sender.Tag); if ($t0) { Close-Toast $t0 'dismiss' }; $e.Handled = $true })
  $card.Add_MouseEnter({ param($sender, $e) $t0 = Get-ToastById ([string]$sender.Tag); if ($t0 -and $t0.Timer) { try { $t0.Timer.Stop() } catch { } } })
  $card.Add_MouseLeave({ param($sender, $e) $t0 = Get-ToastById ([string]$sender.Tag); if ($t0) { Start-Timer $t0 } })
  $win.Add_Closed({ param($sender, $e) $t0 = Get-ToastById ([string]$sender.Tag); if ($t0) { [void]$script:Toasts.Remove($t0) }; Update-Layout })
  $win.Add_SizeChanged({ param($sender, $e) Update-Layout })

  [void]$script:Toasts.Add($toast)
  $win.Show()
  Update-Layout
  Start-Timer $toast
  Write-Event @{ event = 'shown'; id = $id; kind = $kind }
  return $toast
}

function Handle-Command([string]$line) {
  $msg = $null
  try { $msg = $line | ConvertFrom-Json } catch { Write-Event @{ event = 'error'; message = 'bad json' }; return }
  switch ([string]$msg.cmd) {
    'show' { [void](Show-Toast $msg) }
    'close' { $t0 = Get-ToastById ([string]$msg.id); if ($t0) { Close-Toast $t0 'request' } }
    'owner' {
      try { $script:OwnerPid = [int]$msg.pid } catch { $script:OwnerPid = 0 }
      try { $script:OwnerExe = [string]$msg.exe } catch { $script:OwnerExe = '' }
      try { $script:OwnerExeName = [string]$msg.exeName } catch { $script:OwnerExeName = '' }
    }    'debug-click' { Invoke-ToastClick ([string]$msg.id) }
    'debug-raise-timeline' {
      $raised = $false
      try { $raised = [bool](Raise-OwnerWindow) } catch { }
      $samples = @()
      for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 200
        $samples += [string]([OwnerWindow]::IsIconic($script:OwnerHwnd))
      }
      Write-Event @{ event = 'raise-timeline'; ok = $raised; hwnd = [string]$script:OwnerHwnd; iconic = $samples; debug = [string]$script:RaiseDebug }
    }
    'debug-desktop' {
      $sb = New-Object System.Text.StringBuilder 256
      $need = 0
      $desk = [OwnerWindow]::GetThreadDesktop([OwnerWindow]::GetCurrentThreadId())
      [void][OwnerWindow]::GetUserObjectInformation($desk, 2, $sb, 256, [ref]$need)
      $main = Get-Process -Id 38480 -ErrorAction SilentlyContinue
      Write-Event @{ event = 'desktop'; desktop = $sb.ToString(); session = (Get-Process -Id $PID).SessionId; hwnd = [string]$script:OwnerHwnd; isIconic = ([OwnerWindow]::IsIconic($script:OwnerHwnd)); procMain = [string]$main.MainWindowHandle; procTitle = [string]$main.MainWindowTitle }
    }
    'debug-ancestors' { $pids = Get-OwnerPids; Write-Event @{ event = 'ancestors'; pids = @($pids.Keys) } }
    'close-all' { foreach ($t0 in @($script:Toasts)) { Close-Toast $t0 'request' } }
    'config' {
      $c = $msg.config
      if ($c) {
        if ($c.locale) { $script:Config.locale = [string]$c.locale }
        if ($c.width) { $script:Config.width = [int]$c.width }
        if ($c.durationMs) { $script:Config.durationMs = [int]$c.durationMs }
        if ($c.maxVisible) { $script:Config.maxVisible = [int]$c.maxVisible }
        if ($c.colors) {
          foreach ($kind in @($script:Config.colors.Keys)) {
            $incoming = $c.colors.$kind
            if ($incoming) {
              if ($incoming.bg) { $script:Config.colors[$kind].bg = [string]$incoming.bg }
              if ($incoming.fg) { $script:Config.colors[$kind].fg = [string]$incoming.fg }
              if ($incoming.accent) { $script:Config.colors[$kind].accent = [string]$incoming.accent }
            }
          }
        }
        Update-Layout
      }
      Write-Event @{ event = 'config'; ok = $true }
    }
    'preview' {
      $samples = @(
        @{ kind = 'completed'; title = '重构上传接口'; text = '主线任务完成，已生成 3 个文件，并更新了 2 处类型声明与 1 个测试用例，构建通过。' },
        @{ kind = 'permission'; title = '需要你确认'; text = 'bash: rm -rf build/  —  允许执行？' },
        @{ kind = 'sidelinedone'; title = '支线任务全部结束'; text = '4 个后台会话已完成' }
      )
      $i = 0
      foreach ($s in $samples) {
        $s.id = 'preview-' + $i
        $s.durationMs = 6000
        [void](Show-Toast ([pscustomobject]$s))
        $i = $i + 1
      }
    }
    'ping' { Write-Event @{ event = 'pong'; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } }
    'shutdown' { $script:Running = $false }
  }
}

$script:Pump = New-Object System.Windows.Threading.DispatcherTimer
$script:Pump.Interval = [TimeSpan]::FromMilliseconds(50)
$script:Pump.Add_Tick({
  if (-not $script:Running) { $script:Pump.Stop(); [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown(); return }
  try {
    $line = ''
    while ([StdinQueue]::Lines.TryDequeue([ref]$line)) {
      if ($line.Trim().Length -gt 0) { Handle-Command $line.Trim() }
    }
    if ([StdinQueue]::Closed -and [StdinQueue]::Lines.IsEmpty -and $HoldSeconds -le 0) { $script:Running = $false }
  } catch {
    Write-Event @{ event = 'error'; message = [string]$_.Exception.Message }
  }
})

[StdinQueue]::Start()
$script:Pump.Start()
Write-Event @{ event = 'ready'; pid = $PID; width = (Get-WorkArea).Width }

if ($HoldSeconds -gt 0) {
  $script:HoldTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:HoldTimer.Interval = [TimeSpan]::FromSeconds($HoldSeconds)
  $script:HoldTimer.Add_Tick({ $script:HoldTimer.Stop(); $script:Running = $false })
  $script:HoldTimer.Start()
}

if ($PreviewMode) { Handle-Command '{"cmd":"preview"}' }

[System.Windows.Threading.Dispatcher]::Run()
