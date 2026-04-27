import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Phil Finance',
    short_name: 'Phil',
    description: 'Personal finance tracker for Evan & Rachel',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#030712',
    theme_color: '#030712',
    orientation: 'portrait',
    icons: [
      { src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
      // Replace with icon-192.png + icon-512.png in public/ for full PWA install support
    ],
    categories: ['finance', 'productivity'],
  }
}
