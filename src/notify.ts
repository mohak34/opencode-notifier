import notifier from "node-notifier"

const NOTIFICATION_TITLE = "OpenCode"

export async function sendNotification(
  message: string,
  timeout: number
): Promise<void> {
  return new Promise((resolve) => {
    notifier.notify(
      {
        title: NOTIFICATION_TITLE,
        message: message,
        sound: false,
        timeout: timeout,
        icon: undefined,
      },
      () => {
        resolve()
      }
    )
  })
}
