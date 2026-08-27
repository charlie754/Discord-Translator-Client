// Discord Translator - free translation proxy.
// Runs in YOUR Google account, on YOUR Apps Script quota.
// No Cloud project, no billing account, no credit card.
//
// THE DEPLOYMENT URL IS THE CREDENTIAL. TREAT IT LIKE A PASSWORD.
// This is deployed as "Anyone", so no sign-in stands in front of it: whoever
// holds the URL can call it and spend your daily translation quota. Nothing can
// be charged, because Apps Script has no billing, and the quota resets daily.

function doPost(e) {
  var body, texts, target, source, out;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ error: 'body was not valid JSON' });
  }
  texts = body.q;
  target = body.target;
  source = body.source || '';
  if (!Array.isArray(texts) || !target) {
    return json({ error: 'expected { q: ["text"], target: "en" }' });
  }
  try {
    out = texts.map(function (t) {
      return LanguageApp.translate(t, source, target);
    });
  } catch (err) {
    return json({ error: 'translation failed' });
  }
  return json({ translations: out });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
