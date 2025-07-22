// Notification system for temporary user messages
// Provides toast-style notifications that auto-dismiss

let notificationContainer = null;
let notificationQueue = [];
let isProcessingQueue = false;

// Initialize notification container
function initNotificationContainer() {
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'notification-container';
    notificationContainer.className = 'notification-container';
    document.body.appendChild(notificationContainer);
  }
}

// Create notification element
function createNotificationElement(message, type = 'warning') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  return notification;
}

// Show notification with animation
function displayNotification(notification, duration = 4000) {
  initNotificationContainer();
  
  // Add to container
  notificationContainer.appendChild(notification);
  
  // Trigger slide-in animation
  requestAnimationFrame(() => {
    notification.classList.add('notification-show');
  });
  
  // Auto-dismiss after duration
  setTimeout(() => {
    dismissNotification(notification);
  }, duration);
}

// Dismiss notification with animation
function dismissNotification(notification) {
  if (notification && notification.parentNode) {
    notification.classList.remove('notification-show');
    notification.classList.add('notification-hide');
    
    // Remove from DOM after animation
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      processNotificationQueue();
    }, 300);
  }
}

// Process queued notifications
function processNotificationQueue() {
  if (notificationQueue.length > 0 && !isProcessingQueue) {
    isProcessingQueue = true;
    const { message, type, duration } = notificationQueue.shift();
    const notification = createNotificationElement(message, type);
    displayNotification(notification, duration);
    
    // Reset processing flag after notification is shown
    setTimeout(() => {
      isProcessingQueue = false;
    }, 500);
  }
}

// Main function to show notifications
export function showNotification(message, type = 'warning', duration = 4000) {
  // Add to queue to prevent overlapping
  notificationQueue.push({ message, type, duration });
  
  // Process immediately if not already processing
  if (!isProcessingQueue) {
    processNotificationQueue();
  }
}

// Convenience functions for different notification types
export function showWarning(message, duration = 4000) {
  showNotification(message, 'warning', duration);
}

export function showInfo(message, duration = 3000) {
  showNotification(message, 'info', duration);
}

export function showError(message, duration = 5000) {
  showNotification(message, 'error', duration);
}