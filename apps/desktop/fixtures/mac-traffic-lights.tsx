// A drawing for the stories and the screen capture. It never goes into `src/`.
/**
 * The macOS window buttons, drawn where tauri.macos.conf.json asks for them
 * (x 14, centered in the 36 px title bar), so that a screenshot shows the
 * space that they take. Check the real position on a Mac.
 */
export function MacTrafficLights() {
  const colors = ['#ff5f57', '#febc2e', '#28c840']
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 12,
        left: 14,
        display: 'flex',
        gap: 8,
        zIndex: 50,
      }}
    >
      {colors.map((color) => (
        <span
          key={color}
          style={{
            width: 12,
            height: 12,
            borderRadius: 9999,
            background: color,
            boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 0.2)',
          }}
        />
      ))}
    </div>
  )
}
