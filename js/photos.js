// 일지 사진: 올리기 전에 크기를 줄이고(무료 저장 공간 1GB 아끼기), 볼 때는 잠깐 쓰는 주소를 받아요.
import { sb, rpc, friendlyError } from './api.js';

const BUCKET = 'photos';
const MAX_SIDE = 1600;
const MAX_BYTES = 3 * 1024 * 1024;
export const MAX_PHOTOS_PER_LOG = 6;

async function shrink(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (blob) return blob;
  } catch {
    // 줄이지 못하는 형식이면 원본을 그대로 써요.
  }
  return file;
}

function randomName() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 사진 여러 장을 올리고 일지에 붙여요. 실패한 장 수를 돌려줘요.
export async function uploadLogPhotos(userId, logId, files, onProgress) {
  let failed = 0;
  let done = 0;
  for (const file of files) {
    try {
      if (!/^image\//.test(file.type)) throw new Error('사진 파일만 올릴 수 있어요.');
      const blob = await shrink(file);
      if (blob.size > MAX_BYTES) throw new Error('사진이 너무 커요(3MB까지).');
      const type = blob.type && ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) ? blob.type : 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${userId}/${logId}/${randomName()}.${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
      if (error) throw new Error(friendlyError(error));
      try {
        await rpc('add_log_photo', { p_log_id: logId, p_path: path, p_caption: null });
      } catch (err) {
        await sb.storage.from(BUCKET).remove([path]);
        throw err;
      }
    } catch (err) {
      console.warn(err);
      failed += 1;
    }
    done += 1;
    onProgress?.(done, files.length);
  }
  return failed;
}

export async function deletePhoto(photoId) {
  const path = await rpc('delete_log_photo', { p_id: photoId });
  if (path) await sb.storage.from(BUCKET).remove([path]);
}

// 사진 행 목록 → path → 주소 Map (1시간 동안 쓸 수 있어요)
export async function signedUrls(photos) {
  const paths = photos.map((p) => p.path);
  if (!paths.length) return new Map();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error(friendlyError(error));
  return new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}
