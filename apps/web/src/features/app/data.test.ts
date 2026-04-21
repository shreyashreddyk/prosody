import { afterEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();
const uploadMock = vi.fn();

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: insertMock,
      update: updateMock,
    }),
    storage: {
      from: () => ({
        upload: uploadMock,
      }),
    },
  },
}));

import { uploadSource } from "./data";

describe("uploadSource", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a canonical source row, uploads the file, and marks it ready", async () => {
    insertMock.mockResolvedValue({ error: null });
    eqMock.mockResolvedValue({ error: null });
    updateMock.mockReturnValue({ eq: eqMock });
    uploadMock.mockResolvedValue({ error: null });

    const file = new File(["resume"], "resume.txt", { type: "text/plain" });
    await uploadSource("user-1", "conv-1", file);

    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0][0];
    expect(inserted).toMatchObject({
      conversation_id: "conv-1",
      owner_user_id: "user-1",
      kind: "document",
      filename: "resume.txt",
      mime_type: "text/plain",
      storage_bucket: "conversation-sources",
      processing_status: "pending",
      error_message: null,
    });
    expect(inserted.storage_path).toMatch(/^user\/user-1\/conversations\/conv-1\/sources\/[^/]+\/resume\.txt$/);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ processing_status: "ready", error_message: null });
    expect(eqMock).toHaveBeenCalledWith("id", inserted.id);
  });

  it("marks the source as failed and rethrows when the storage upload fails", async () => {
    insertMock.mockResolvedValue({ error: null });
    eqMock.mockResolvedValue({ error: null });
    updateMock.mockReturnValue({ eq: eqMock });
    uploadMock.mockResolvedValue({ error: new Error("storage upload failed") });

    const file = new File(["resume"], "resume.txt", { type: "text/plain" });

    await expect(uploadSource("user-1", "conv-1", file)).rejects.toThrow("storage upload failed");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      processing_status: "failed",
      error_message: "storage upload failed",
    });
  });

  it("rethrows insert errors without attempting to upload", async () => {
    insertMock.mockResolvedValue({ error: new Error("insert failed") });

    const file = new File(["resume"], "resume.txt", { type: "text/plain" });

    await expect(uploadSource("user-1", "conv-1", file)).rejects.toThrow("insert failed");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
