import type { Plugin } from "@opencode-ai/plugin"
import { createNotifierPluginInstance } from "./plugin"

// Only export default - OpenCode loads this
const NotifierPlugin: Plugin = async (_input) => {
  return createNotifierPluginInstance()
}

export default NotifierPlugin
