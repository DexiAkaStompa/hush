const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function registerAttachmentDownloads({ ipcMain, dialog, windowForEvent }) {
  const transfers = new Map();
  async function abort(token) {
    const transfer = transfers.get(token);
    if (!transfer) return;
    transfers.delete(token);
    transfer.sender.removeListener("destroyed", transfer.onDestroyed);
    await transfer.pending.catch(() => {});
    await transfer.file.close().catch(() => {});
    await fs.unlink(transfer.temporary).catch(() => {});
  }
  function owned(event, token) {
    if (!windowForEvent(event)) throw new Error("Download non autorizzato.");
    const transfer = transfers.get(token);
    if (!transfer || transfer.owner !== event.sender.id) throw new Error("Download non valido.");
    return transfer;
  }
  ipcMain.handle("attachment:save-begin", async (event, name) => {
    const window = windowForEvent(event);
    if (!window || typeof name !== "string") throw new Error("Download non valido.");
    if ([...transfers.values()].some(item => item.owner === event.sender.id)) throw new Error("Un download è già in corso.");
    const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180) || "allegato" });
    if (result.canceled || !result.filePath) return null;
    const token = randomUUID();
    const temporary = result.filePath + ".hush-" + token + ".part";
    if ([...transfers.values()].some(item => item.owner === event.sender.id)) throw new Error("Un download è già in corso.");
    const file = await fs.open(temporary, "wx", 0o600);
    const onDestroyed = () => { void abort(token); };
    transfers.set(token, { owner: event.sender.id, sender:event.sender, onDestroyed, temporary, destination: result.filePath, file, pending: Promise.resolve(), index: 0, writing:false });
    event.sender.once("destroyed", onDestroyed);
    return token;
  });
  ipcMain.handle("attachment:save-write", async (event, token, index, bytes) => {
    const transfer = owned(event, token);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 8 * 1024 * 1024 || index !== transfer.index || transfer.writing) throw new Error("Blocco download non valido.");
    transfer.writing = true;
    transfer.index++;
    transfer.pending = transfer.pending.then(async () => {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await transfer.file.write(bytes, offset, bytes.byteLength - offset);
        if (!bytesWritten) throw new Error("Scrittura download interrotta.");
        offset += bytesWritten;
      }
    });
    try { await transfer.pending; } finally { transfer.writing = false; }
  });
  ipcMain.handle("attachment:save-finish", async (event, token) => {
    const transfer = owned(event, token);
    await transfer.pending;
    await transfer.file.sync();
    await transfer.file.close();
    await fs.rename(transfer.temporary, transfer.destination);
    transfers.delete(token);
    transfer.sender.removeListener("destroyed", transfer.onDestroyed);
  });
  ipcMain.handle("attachment:save-abort", async (event, token) => {
    owned(event, token);
    await abort(token);
  });
}

module.exports = { registerAttachmentDownloads };
