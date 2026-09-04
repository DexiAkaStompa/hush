import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), update: vi.fn(), single: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: {
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  from: () => ({ update: mocks.update }),
} }));
import { saveProfile } from "./profile-media";

const profile = { id: "11111111-1111-1111-1111-111111111111", username: "user", display_name: "User", avatar_color: "#73b7ff", avatar_path: "11111111-1111-1111-1111-111111111111/old.gif" };
const draft = { display_name: "New name", avatar_color: "#73b7ff", bio: "Hello" };
const gif = new File(["GIF89a"], "avatar.gif", { type: "image/gif" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: () => ({ select: () => ({ single: mocks.single }) }) });
  mocks.single.mockResolvedValue({ data: { ...profile, ...draft }, error: null });
});
describe("profile media save", () => {
  it("uploads original animation bytes and deletes the old image only after saving", async () => {
    await saveProfile(profile, draft, { avatar: gif, banner: undefined });
    const [path, file, options] = mocks.upload.mock.calls[0];
    expect(path).toMatch(/^11111111-1111-1111-1111-111111111111\/[0-9a-f-]+\.gif$/);
    expect(file).toBe(gif);
    expect(options.upsert).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith({ ...draft, avatar_path: path });
    expect(mocks.remove).toHaveBeenCalledWith([profile.avatar_path]);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.single.mock.invocationCallOrder[0]);
  });
  it("cleans newly uploaded files on failure and preserves the previous avatar", async () => {
    mocks.single.mockResolvedValue({ error: new Error("Network error") });
    await expect(saveProfile(profile, draft, { avatar: gif, banner: undefined })).rejects.toThrow("Network error");
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
    expect(mocks.remove).not.toHaveBeenCalledWith([profile.avatar_path]);
  });
  it("distinguishes removing an image from leaving it unchanged", async () => {
    await saveProfile(profile, draft, { avatar: undefined, banner: undefined });
    expect(mocks.update).toHaveBeenLastCalledWith(draft);
    expect(mocks.remove).not.toHaveBeenCalled();
    await saveProfile(profile, draft, { avatar: null, banner: undefined });
    expect(mocks.update).toHaveBeenLastCalledWith({ ...draft, avatar_path: null });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith([profile.avatar_path]);
  });
});
