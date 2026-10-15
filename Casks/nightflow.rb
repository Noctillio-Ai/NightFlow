cask "nightflow" do
  version "0.2.1"

  url "https://github.com/Noctillio-Ai/NightFlow/releases/download/v#{version}/NightFlow_#{version}_aarch64.dmg",
      verified: "github.com/Noctillio-Ai/NightFlow/"
  sha256 "31b40627737c432505794940929feec8148394cb8a34785667e625f2885d610e"

  name "NightFlow"
  desc "Desktop app for managing and analyzing deep learning experiments"
  homepage "https://github.com/Noctillio-Ai/NightFlow"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: ">= :ventura"

  app "NightFlow.app"

  zap trash: [
    "~/Library/Application Support/com.nightflow.desktop",
    "~/Library/Caches/com.nightflow.desktop",
    "~/Library/Preferences/com.nightflow.desktop.plist",
    "~/Library/Saved Application State/com.nightflow.desktop.savedState",
    "~/Library/WebKit/com.nightflow.desktop",
  ]
end
