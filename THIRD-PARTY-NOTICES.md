# Third-party notices

This project is a derivative work. It ships portions of the two projects below
and follows the design of a third; all three are credited here.

## attention-plugins — MIT

- Upstream: <https://github.com/zjbc2000/attention-plugins>
- Fork we build on: <https://github.com/4478sc/attention-plugins>
- Copyright (c) 2026 zjbc2000
- Used for: notification engine (main-line / side-line edges, settle window,
  batch aggregation), four event types, settings model, composer star and
  session-row menu markers, bilingual copy. Based on the 0.2.1 line, with the 0.2.2 behaviours re-implemented here:
  three-way task mode (including silent), current-session tiers, wait-for-subagents
  and per-session mute. Custom audio and click-through are not implemented.

attention-plugins is itself a rewrite of @dingyi222666/dsh-session-notification,
which is BSD-3-Clause. Its notice is reproduced below.

## dsh-notify-yimit — MIT

- Upstream: <https://github.com/YiMlT/dsh-notify-yimit>
- Copyright (c) 2026 YiMlT
- Used for: the desktop toast host concept — a resident process owning the
  windows, a JSON-lines stdin/stdout protocol, bottom-right stacking, per-kind
  colors and durations. The Windows (WPF) and Linux (GTK) hosts here were
  written from scratch for this project; the idea and wire shape follow it.

## @deepwhale-cn/dsh-approval-ledger — bundled since 0.3.0

- Upstream: <https://github.com/feely0208/dsh-approval-ledger> (MIT, © 温州深鲸智能科技有限公司)
- This repository **contains** the ledger host half under `lib/ledger/`: the
  `approval/request` recorder, the risk scale, the `approval_ledger_query` /
  `approval_ledger_stats` tools and the `/approval-ledger` audit dashboard.
  The JSONL file it writes (`$DSH_HOME/approval-ledger/ledger.jsonl`) is read
  in-process by the toast half, so the separate package is no longer needed.
  Risk levels in that file are advisory only and are shown as "reference only";
  no warranty is given for their accuracy.

## DeepSeek Harness

The plugin targets the DSH plugin API (Cordis services, Typert remote
contributions, client slots). DSH itself is not redistributed here.

---

## Full MIT text (this project and both MIT upstreams)

```text
MIT License

Copyright (c) 2026 温州深鲸智能科技有限公司
Copyright (c) 2026 zjbc2000
Copyright (c) 2026 YiMlT

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## BSD-3-Clause text (dsh-session-notification)

```text
BSD 3-Clause License

Copyright (c) 2026, dingyi222666 (dsh-session-notification)

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
