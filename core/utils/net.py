import socket

# === 端口检测函数 ===
def is_port_available(port, host='127.0.0.1'):
    """
    尝试绑定指定端口，如果成功则说明端口可用。
    注意：只是尝试绑定，检测完会立即释放。
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            # 尝试绑定到 localhost
            s.bind((host, port))
            return True
        except OSError:
            return False