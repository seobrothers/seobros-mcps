/**
 * Creates a Google Doc from HTML content in the specified shared drive folder,
 * then sets permissions: anyone with link can view, @seobrothers.co can edit.
 *
 * Deploy as: Web app → Execute as: Me → Who has access: Anyone
 * Required: Enable Drive API advanced service (Services → Drive API)
 *
 * Deployed URL: https://script.google.com/macros/s/AKfycbxM47GkaG9mM29ZjDl0kDz7DUV6fFVnzjXesJmE4pfYYgrXwFzgFiRsUWRT11138-kF/exec
 *
 */

var FOLDER_ID = "0AC0HMVT45YOzUk9PVA";
var ORG_DOMAIN = "seobrothers.co";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var title = data.title;
    var html = data.html || "";

    if (!title) {
      return jsonResponse({ success: false, error: "title is required" });
    }

    // Create Google Doc from HTML via Drive API (auto-converts HTML → Docs format)
    var blob = Utilities.newBlob(html, "text/html", title + ".html");
    var resource = {
      name: title,
      mimeType: "application/vnd.google-apps.document",
      parents: [FOLDER_ID],
    };

    var file = Drive.Files.create(resource, blob, {
      supportsAllDrives: true,
    });

    var fileId = file.id;

    // Anyone with the link can view
    Drive.Permissions.create(
      { role: "reader", type: "anyone" },
      fileId,
      { supportsAllDrives: true }
    );

    // Anyone in the org can edit
    Drive.Permissions.create(
      { role: "writer", type: "domain", domain: ORG_DOMAIN },
      fileId,
      { supportsAllDrives: true }
    );

    var docUrl = "https://docs.google.com/document/d/" + fileId + "/edit";

    return jsonResponse({
      success: true,
      docId: fileId,
      docUrl: docUrl,
      title: title,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet() {
  return jsonResponse({
    status: "ok",
    description: "POST {title, html} to create a Google Doc",
  });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}
