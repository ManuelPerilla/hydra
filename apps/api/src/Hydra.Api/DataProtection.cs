using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.AspNetCore.DataProtection.XmlEncryption;
using Npgsql;

namespace Hydra.Api;

// DataProtection loads its key ring synchronously. This uses the shared bounded connection pool.
public sealed class PostgresXmlRepository(NpgsqlDataSource source) : IXmlRepository
{
    public IReadOnlyCollection<XElement> GetAllElements()
    {
        using var command = source.CreateCommand("SELECT xml FROM hydra_data_protection ORDER BY id");
        using var reader = command.ExecuteReader();
        var elements = new List<XElement>();
        while (reader.Read()) elements.Add(XElement.Parse(reader.GetString(0)));
        return elements;
    }
    public void StoreElement(XElement element, string friendlyName)
    {
        using var command = source.CreateCommand("INSERT INTO hydra_data_protection(friendly_name,xml) VALUES (@name,@xml)");
        command.Parameters.AddWithValue("name", friendlyName);
        command.Parameters.AddWithValue("xml", element.ToString(SaveOptions.DisableFormatting));
        command.ExecuteNonQuery();
    }
}
public sealed class AesXmlEncryptor(HydraSettings settings) : IXmlEncryptor
{
    public EncryptedXmlInfo Encrypt(XElement plaintextElement)
    {
        var plaintext = Encoding.UTF8.GetBytes(plaintextElement.ToString(SaveOptions.DisableFormatting));
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(Convert.FromBase64String(settings.DataProtectionKey), 16);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, "Hydra.DataProtection.v1"u8);
        CryptographicOperations.ZeroMemory(plaintext);
        return new(new XElement("hydraEncryptedKey", new XAttribute("version", 1),
            new XElement("nonce", Convert.ToBase64String(nonce)), new XElement("tag", Convert.ToBase64String(tag)),
            new XElement("ciphertext", Convert.ToBase64String(ciphertext))), typeof(AesXmlDecryptor));
    }
}
public sealed class AesXmlDecryptor(IServiceProvider services) : IXmlDecryptor
{
    public XElement Decrypt(XElement encryptedElement)
    {
        if ((string?)encryptedElement.Attribute("version") != "1") throw new CryptographicException("Unsupported key format.");
        var settings = services.GetRequiredService<HydraSettings>();
        var nonce = Convert.FromBase64String(encryptedElement.Element("nonce")!.Value);
        var tag = Convert.FromBase64String(encryptedElement.Element("tag")!.Value);
        var ciphertext = Convert.FromBase64String(encryptedElement.Element("ciphertext")!.Value);
        var plaintext = new byte[ciphertext.Length];
        using var aes = new AesGcm(Convert.FromBase64String(settings.DataProtectionKey), 16);
        aes.Decrypt(nonce, ciphertext, tag, plaintext, "Hydra.DataProtection.v1"u8);
        try { return XElement.Parse(Encoding.UTF8.GetString(plaintext)); }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
}
