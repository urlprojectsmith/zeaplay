from pathlib import Path

path = Path('App.tsx')
text = path.read_text(encoding='utf-8')

if "import Chat from './pages/Chat';" not in text:
    replacement = "import Achievements from './pages/Achievements';\r\nimport RewardManagement from './pages/RewardManagement';\r\n"
    if replacement not in text:
        raise SystemExit('Unable to locate import section in App.tsx')
    text = text.replace(replacement, "import Achievements from './pages/Achievements';\r\nimport RewardManagement from './pages/RewardManagement';\r\nimport Chat from './pages/Chat';\r\n", 1)
    path.write_text(text, encoding='utf-8')
