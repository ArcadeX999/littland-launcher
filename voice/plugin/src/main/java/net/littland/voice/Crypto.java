package net.littland.voice;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** P-256 ECDH key exchange and AES-256-GCM, as described in PROTOCOL.md. */
final class Crypto {
    static final int PUBLIC_KEY_LENGTH = 65;
    static final int NONCE_LENGTH = 12;
    static final int TAG_BITS = 128;
    private static final byte[] KEY_INFO = "littland-voice-v1".getBytes(StandardCharsets.US_ASCII);
    private static final SecureRandom RANDOM = new SecureRandom();

    private Crypto() {
    }

    static KeyPair newKeyPair() throws GeneralSecurityException {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    /** Uncompressed point encoding: 0x04 || X || Y. */
    static byte[] encodePublicKey(PublicKey key) {
        ECPoint w = ((ECPublicKey) key).getW();
        byte[] out = new byte[PUBLIC_KEY_LENGTH];
        out[0] = 0x04;
        copyFixed(w.getAffineX(), out, 1);
        copyFixed(w.getAffineY(), out, 33);
        return out;
    }

    static PublicKey decodePublicKey(byte[] encoded, PublicKey sameCurve) throws GeneralSecurityException {
        if (encoded.length != PUBLIC_KEY_LENGTH || encoded[0] != 0x04) {
            throw new GeneralSecurityException("bad public key");
        }
        byte[] x = new byte[32];
        byte[] y = new byte[32];
        System.arraycopy(encoded, 1, x, 0, 32);
        System.arraycopy(encoded, 33, y, 0, 32);
        ECPoint point = new ECPoint(new BigInteger(1, x), new BigInteger(1, y));
        ECPublicKeySpec spec = new ECPublicKeySpec(point, ((ECPublicKey) sameCurve).getParams());
        return KeyFactory.getInstance("EC").generatePublic(spec);
    }

    static SecretKeySpec deriveKey(KeyPair ours, PublicKey theirs) throws GeneralSecurityException {
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(ours.getPrivate());
        agreement.doPhase(theirs, true);
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        sha.update(agreement.generateSecret());
        sha.update(KEY_INFO);
        return new SecretKeySpec(sha.digest(), "AES");
    }

    static byte[] newNonce() {
        byte[] nonce = new byte[NONCE_LENGTH];
        RANDOM.nextBytes(nonce);
        return nonce;
    }

    static byte[] encrypt(SecretKeySpec key, byte[] nonce, byte[] plain) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
        return cipher.doFinal(plain);
    }

    static byte[] decrypt(SecretKeySpec key, byte[] nonce, byte[] data, int offset, int length)
            throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
        return cipher.doFinal(data, offset, length);
    }

    static int randomSessionId() {
        int id;
        do {
            id = RANDOM.nextInt();
        } while (id == 0);
        return id;
    }

    private static void copyFixed(BigInteger value, byte[] out, int offset) {
        byte[] raw = value.toByteArray();
        // BigInteger may add a sign byte or be shorter than 32 bytes.
        int length = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - length, out, offset + 32 - length, length);
    }
}
