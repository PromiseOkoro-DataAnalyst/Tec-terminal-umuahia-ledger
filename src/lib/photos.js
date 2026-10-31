// Free photos from Unsplash (Unsplash License — free for commercial use, no permission needed).
// All taken in Lagos. To use your own instead, put a file in /public and change `src` to e.g. '/my-photo.jpg'.
const unsplash = (id, width = 1600) =>
  `https://images.unsplash.com/${id}?fm=jpg&q=72&w=${width}&auto=format&fit=crop`

export const PHOTOS = {
  // Yaba, Lagos — woman working on a laptop with a colleague
  yaba: { src: unsplash('photo-1526253038957-bce54e05968e'), credit: 'X (@disruptxn)', link: 'https://unsplash.com/photos/BVr3XaBiWLU' },
  // Lagos — young woman with a laptop at a café table
  cafe: { src: unsplash('photo-1739301674006-75fe9653368f', 1000), credit: 'Ninthgrid', link: 'https://unsplash.com/photos/GhRO_RkDPlc' },
  // Lagos — two friends working together on laptops
  friends: { src: unsplash('photo-1739303987830-ca19742b19bc', 1200), credit: 'Ninthgrid', link: 'https://unsplash.com/photos/bD3DiLuuOPM' },
  // Lagos Business School — graduates in caps and gowns
  graduates: { src: unsplash('photo-1769905226600-1d447fe7d020', 1400), credit: 'Blessfield John', link: 'https://unsplash.com/photos/sgQM3gsGD9s' },
}

// Which photos each sign-in screen uses: one large, two small
export const SCENES = {
  signin: { main: PHOTOS.yaba, small: [PHOTOS.cafe, PHOTOS.graduates] },
  signup: { main: PHOTOS.friends, small: [PHOTOS.yaba, PHOTOS.graduates] },
  reset: { main: PHOTOS.cafe, small: [PHOTOS.friends, PHOTOS.yaba] },
  pending: { main: PHOTOS.graduates, small: [PHOTOS.friends, PHOTOS.cafe] },
}
