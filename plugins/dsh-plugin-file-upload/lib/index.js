/**
 * dsh-plugin-file-upload — host half.
 *
 * No-op on the host: the feature is entirely browser-side. This file exists
 * so the bundle patch (`- insert: dsh-plugin-file-upload`) resolves to a
 * valid cordis service; the client half in lib/client.js registers the
 * composer button.
 */
export default {
  inject: [],
  config: {},
  apply() {
    // Nothing to do host-side.
  },
};
