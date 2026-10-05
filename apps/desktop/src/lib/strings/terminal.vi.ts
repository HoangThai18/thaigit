/** The terminal inside the repo window (below the graph / diff). */
export const terminal = {
  button: 'Terminal',
  buttonTip: 'Mở / ẩn terminal ở thư mục repo (Ctrl+`)',
  title: 'Terminal',
  titleNumbered: (index: number) => `Terminal ${index}`,
  newTab: 'Thêm tab terminal',
  closeTab: 'Đóng tab (dừng shell của tab này)',
  hide: 'Ẩn terminal (Ctrl+`) — các lệnh đang chạy vẫn tiếp tục',
  resize: 'Kéo để đổi chiều cao terminal',
  unavailable: 'Terminal chỉ chạy trong app Thaigit.',
} as const;
