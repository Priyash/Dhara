const CLOUD_NAME     = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET  = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

/**
 * Upload a File directly to Cloudinary (unsigned preset).
 * Returns the secure_url of the uploaded asset.
 */
export async function uploadToCloudinary(file, { folder = 'dhara', onProgress } = {}) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      'Missing VITE_CLOUDINARY_CLOUD_NAME or VITE_CLOUDINARY_UPLOAD_PRESET in your .env file.'
    )
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', UPLOAD_PRESET)
  formData.append('folder', folder)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText)
        resolve(data.secure_url)
      } else {
        try {
          const err = JSON.parse(xhr.responseText)
          reject(new Error(err?.error?.message || `Cloudinary HTTP ${xhr.status}`))
        } catch {
          reject(new Error(`Cloudinary HTTP ${xhr.status}`))
        }
      }
    }

    xhr.onerror = () => reject(new Error('Network error during Cloudinary upload'))
    xhr.send(formData)
  })
}

/**
 * Insert Cloudinary transformations into an existing secure_url.
 * e.g. cloudinaryTransform(url, 'w_400,h_600,c_fill,g_auto,f_auto,q_auto')
 */
export function cloudinaryTransform(url, transforms) {
  if (!url || !url.includes('/upload/')) return url
  return url.replace('/upload/', `/upload/${transforms}/`)
}
