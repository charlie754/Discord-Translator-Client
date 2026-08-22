/*
 * Registers the translation transport. MV3 requires every message listener to be
 * registered synchronously at worker startup — the worker is torn down when idle,
 * and a listener added later would not be there to wake it for the next request.
 *
 * Firefox loads the same file through manifestv2.json's background.scripts instead.
 */
importScripts("translationHost.js");
