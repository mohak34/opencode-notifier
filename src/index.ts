import type { Plugin } from "@opencode-ai/plugin"

import { createNotifierPluginInstance } from "./plugin"

const NotifierPlugin: Plugin = async (input) => {
  return createNotifierPluginInstance(input)
}

export default NotifierPlugin
