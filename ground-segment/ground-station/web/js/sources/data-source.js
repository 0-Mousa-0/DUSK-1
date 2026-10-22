/**
 * The contract every data source keeps. The app only talks to this shape, so a new
 * source (for example a cloud relay) plugs in without touching any view.
 *
 *   kind        'live' | 'replay' | 'demo'
 *   label       text of the header button, e.g. 'LIVE · BACKEND'
 *   remote      true when watching through the public link
 *   canCommand  true when send() really reaches the CanSat (or the simulator)
 *   start(sink) begins pushing messages: sink({type: 'telemetry', ...})
 *   stop()      stops pushing
 *   send(text)  resolves to {state: 'SENT' | 'FAILED' | 'SIMULATED', note}
 *   csvUrl()    where to download this session's CSV, or null
 *   describe(link)  one line for the overview's "Data source" row
 */
export class DataSource {
  constructor(kind, label) {
    this.kind = kind;
    this.label = label;
    this.remote = false;
    this.canCommand = false;
  }

  start(sink) { this.sink = sink; }
  stop() {}
  async send(text) { return { state: 'FAILED', note: 'this data source cannot send commands' }; }
  csvUrl() { return null; }
  describe(link) { return this.label; }
}
