from cryptography.fernet import Fernet
import base64
import os

class SecureDataHandler:
    def __init__(self, key=None):
        self.key = key or self.generate_key()
        self.cipher_suite = Fernet(self.key)

    def generate_key(self):
        key = Fernet.generate_key()
        with open('secret.key', 'wb') as key_file:
            key_file.write(key)
        return key

    def load_key(self):
        return open('secret.key', 'rb').read()

    def encrypt_data(self, data):
        if isinstance(data, str):
            data = data.encode()
        encrypted_data = self.cipher_suite.encrypt(data)
        return encrypted_data

    def decrypt_data(self, encrypted_data):
        decrypted_data = self.cipher_suite.decrypt(encrypted_data)
        return decrypted_data.decode()

    def store_encrypted_data(self, encrypted_data, filename):
        with open(filename, 'wb') as file:
            file.write(encrypted_data)

    def load_encrypted_data(self, filename):
        with open(filename, 'rb') as file:
            encrypted_data = file.read()
        return encrypted_data

if __name__ == "__main__":
    handler = SecureDataHandler()
    data = "Sensitive user activity data"
    encrypted = handler.encrypt_data(data)
    handler.store_encrypted_data(encrypted, 'activity_data.enc')

    encrypted_data = handler.load_encrypted_data('activity_data.enc')
    decrypted = handler.decrypt_data(encrypted_data)
    print(f"Decrypted data: {decrypted}")
