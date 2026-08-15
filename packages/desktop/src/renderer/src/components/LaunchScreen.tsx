const logoUrl = new URL("../../../../build/icon.png", import.meta.url).href

export function LaunchScreen() {
  return (
    <div className="launch-screen">
      <div className="launch-screen__content" role="status" aria-label="HydraCode is loading">
        <img className="launch-screen__logo" src={logoUrl} alt="" />
      </div>
    </div>
  )
}
