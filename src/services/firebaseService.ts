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
  // Data-only message - triggers background handler even when app is killed
  // DO NOT include 'notification' field - that prevents background handler from running
  const message = {
    token: fcmToken,
    data: {
      type: 'incoming-call',
      callerId: callerId,
      callerName: callerName,
      callId: callId,
      timestamp: Date.now().toString(),
    },
    android: {
      priority: 'high' as const,
      ttl: 60000, // 60 seconds
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'background',
      },
      payload: {
        aps: {
          contentAvailable: true,
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('[FCM] Call notification sent successfully:', response);
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

export async function sendUpdateNotification(
  fcmToken: string,
  title: string,
  message: string
): Promise<void> {
  const notification = {
    token: fcmToken,
    notification: {
      title,
      body: message,
    },
    data: {
      type: 'update',
      title,
      message,
    },
    android: {
      priority: 'high' as const,
      notification: {
        channelId: 'updates',
        priority: 'high' as const,
        sound: 'default',
      },
    },
  };

  try {
    const response = await admin.messaging().send(notification);
    console.log('[FCM] Update notification sent successfully:', response);
  } catch (error) {
    console.error('[FCM] Error sending update notification:', error);
  }
}

export default admin;