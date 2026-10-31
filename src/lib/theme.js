const KEY = 'tt-theme'

export const getTheme = () => {
  try {
    return localStorage.getItem(KEY) || 'light'
  } catch {
    return 'light'
  }
}

export const setTheme = (theme) => {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
}
