import admin from 'firebase-admin';
import path from 'path';

// Initialize Firebase Admin
const serviceAccount = require(path.join(__dirname, '../../firebase-service-account.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export async function sendPushNotification(
  fcmToken: string,
  callerId: string,
  callerName: string,
  callId: string
): Promise<void> {
  const message = {
    token: fcmToken,
    notification: {
      title: 'Incoming Call',
      body: `${callerName} is calling...`,
    },
    data: {
      type: 'incoming-call',
      callerId: callerId,
      callerName: callerName,
      callId: callId,
    },
    android: {
      priority: 'high' as const,
      notification: {
        channelId: 'incoming-call',
        priority: 'high' as const,
        sound: 'default',
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('[FCM] Notification sent successfully:', response);
  } catch (error) {
    console.error('[FCM] Error sending notification:', error);
  }
}

export async function sendMessageNotification(
  fcmToken: string,
  senderId: string,
  senderName: string,
  messageText: string,
  messageId: string
): Promise<void> {
  const message = {
    token: fcmToken,
    notification: {
      title: `New message from ${senderName}`,
      body: messageText,
    },
    data: {
      type: 'new-message',
      senderId: senderId,
      senderName: senderName,
      messageText: messageText,
      messageId: messageId,
    },
    android: {
      priority: 'high' as const,
      notification: {
        channelId: 'messages',
        priority: 'high' as const,
        sound: 'default',
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('[FCM] Message notification sent successfully:', response);
  } catch (error) {
    console.error('[FCM] Error sending message notification:', error);
  }
}

export default admin;