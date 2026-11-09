cask "nightflow" do
  version "0.7.1"
  sha256 "ad0b11affa0f0217a2b0e32d3c9e12a65bdb681eee4ad1e2722ed9b7728d939b"

  url "https://github.com/Noctillio-Ai/NightFlow/releases/download/v#{version}/NightFlow_#{version}_aarch64.dmg"
  name "NightFlow"
  desc "Desktop app for managing and analyzing deep learning experiments"
  homepage "https://github.com/Noctillio-Ai/NightFlow"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :ventura

  app "NightFlow.app"

  # NightFlow is ad-hoc signed, not notarized, so macOS refuses to open it while
  # it carries the quarantine flag from the download. Clear it on this app only,
  # as install.sh does. Runs after every install and upgrade.
  postflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "{{appdir}}/NightFlow.app"],
        must_succeed:   false,
        writable_paths: ["NightFlow.app"],
        writable_base:  :appdir
  end

  zap trash: [
    "~/Library/Application Support/com.nightflow.desktop",
    "~/Library/Caches/com.nightflow.desktop",
    "~/Library/Preferences/com.nightflow.desktop.plist",
    "~/Library/Saved Application State/com.nightflow.desktop.savedState",
    "~/Library/WebKit/com.nightflow.desktop",
  ]
end
