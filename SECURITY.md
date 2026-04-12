# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 5.x     | :white_check_mark: |
| < 5.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in AutoKube, please report it responsibly.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please report security issues to: **security@autokube.io** (or your designated security contact email)

Include the following information:
- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Suggested fix (if available)
- Your contact information

### Response Timeline

- **Initial Response**: Within 48 hours of report submission
- **Status Update**: Within 7 days with assessment and timeline
- **Resolution**: Security patches released based on severity
  - Critical: 1-3 days
  - High: 7-14 days
  - Medium: 30 days
  - Low: 90 days

## Security Best Practices

### Deployment

1. **TLS/HTTPS**: Always deploy AutoKube behind TLS in production
2. **Network Security**: Use firewalls and network policies to restrict access
3. **Authentication**: Enable authentication and avoid running in `AUTH_DISABLED` mode in production
4. **RBAC**: Configure role-based access control with least privilege principle
5. **Regular Updates**: Keep AutoKube and dependencies up to date

### Credential Management

AutoKube handles sensitive Kubernetes credentials. Security measures in place:

- **Encryption at Rest**: All sensitive fields (kubeconfig, bearer tokens, TLS certificates, SSH keys) are encrypted using AES-256-GCM
- **Encryption Key**: Auto-generated on first run or provided via `ENCRYPTION_KEY` environment variable
- **Key Storage**: Store encryption keys securely; never commit to version control
- **Credential Scope**: Grant minimal necessary Kubernetes RBAC permissions to service accounts

### Database Security

#### SQLite (Default)
- Store database file with restricted file permissions (`chmod 600`)
- Backup encryption keys separately from database backups
- Keep `data/` directory outside web-accessible paths

#### PostgreSQL
- Use strong passwords for database connections
- Enable TLS for database connections in production
- Restrict database access to application host only
- Regular security updates for PostgreSQL server

### Authentication & Authorization

1. **Password Security**
   - Passwords hashed with bcrypt (cost factor 10)
   - Enforce strong password policies in production
   - Enable MFA for privileged accounts

2. **Session Management**
   - Session tokens are cryptographically random
   - Sessions expire after inactivity
   - Implement session rotation on privilege escalation

3. **External Authentication**
   - LDAP: Use LDAPS (LDAP over TLS) connections
   - OIDC: Validate JWT signatures and claims
   - Verify issuer URLs match expected providers

### Agent Security

When using in-cluster agent mode:

1. **Agent Tokens**: Auto-generated tokens are encrypted and unique per cluster
2. **WebSocket Security**: Use WSS (WebSocket Secure) in production
3. **Agent RBAC**: Deploy agent with ServiceAccount having minimal required permissions
4. **Network Policies**: Restrict agent pod network access to API server only

### API Security

1. **CORS**: Configure appropriate CORS policies for your domain
2. **Rate Limiting**: Implement rate limiting for API endpoints
3. **Input Validation**: All user inputs are validated and sanitized
4. **SQL Injection**: Parameterized queries via Drizzle ORM prevent SQL injection
5. **XSS Protection**: Content Security Policy headers configured

### Audit & Monitoring

- **Audit Logging**: All mutations logged to `audit_logs` table
- **Failed Login Attempts**: Monitor for brute force attacks
- **Cluster Access**: Track all Kubernetes API operations
- **IP Tracking**: Audit logs include source IP addresses
- **Log Retention**: Configure appropriate retention policies

## Known Security Considerations

### Kubernetes Access

AutoKube requires credentials to access Kubernetes clusters. This creates inherent security responsibilities:

1. **Credential Storage**: While encrypted, the application has access to decrypt credentials
2. **Cluster Permissions**: AutoKube acts with the permissions of the provided credentials
3. **Multi-Tenancy**: Carefully configure RBAC to isolate users and clusters
4. **Namespace Isolation**: Use namespace-scoped roles to limit blast radius

### Self-Hosted Deployment

As a self-hosted solution, security depends on your infrastructure:

1. **Server Hardening**: Follow OS-level security best practices
2. **Network Segmentation**: Isolate AutoKube in secure network zones
3. **Backup Security**: Encrypt backups containing the database
4. **Access Logs**: Monitor server access logs for suspicious activity
5. **Disaster Recovery**: Test recovery procedures regularly

### AI Features

If using AI chat integration:

1. **API Key Security**: Store provider API keys in environment variables only
2. **Data Privacy**: Consider data sent to third-party AI providers
3. **Context Limitation**: AI receives cluster resource information
4. **Compliance**: Verify AI provider meets your compliance requirements

### Dependencies

- Regularly audit npm/bun dependencies for vulnerabilities
- Review `package.json` for outdated or deprecated packages
- Use `bun audit` or similar tools for vulnerability scanning
- Keep SvelteKit, Bun, and other core dependencies updated

## Security Features

### Implemented Protections

✅ AES-256-GCM encryption for sensitive data  
✅ Bcrypt password hashing  
✅ RBAC with fine-grained permissions  
✅ Audit logging for all mutations  
✅ SQL injection prevention via ORM  
✅ XSS protection via Content Security Policy  
✅ CSRF protection (SvelteKit built-in)  
✅ Secure session management  
✅ Input validation and sanitization  
✅ TLS certificate verification (configurable)  
✅ Multi-factor authentication support  
✅ LDAP/OIDC integration  

### Hardening Checklist

Before deploying to production:

- [ ] Enable HTTPS with valid TLS certificates
- [ ] Generate strong `ENCRYPTION_KEY` (32 bytes, base64-encoded)
- [ ] Set `NODE_TLS_REJECT_UNAUTHORIZED=1` (or unset) for TLS verification
- [ ] Configure database with authentication and encryption
- [ ] Enable authentication (do not use `AUTH_DISABLED` mode)
- [ ] Create user roles with least privilege
- [ ] Configure RBAC for cluster access segregation
- [ ] Set up audit log monitoring and alerting
- [ ] Implement backup and disaster recovery procedures
- [ ] Configure firewall rules to restrict network access
- [ ] Enable MFA for administrative accounts
- [ ] Review and restrict CORS origins
- [ ] Set up intrusion detection/prevention systems
- [ ] Configure log aggregation and monitoring
- [ ] Document incident response procedures

## Compliance Considerations

AutoKube can be part of a compliant infrastructure, but requires proper configuration:

- **GDPR**: Implement data retention policies, user data deletion procedures
- **SOC 2**: Enable comprehensive audit logging, implement access controls
- **HIPAA**: Encrypt data at rest and in transit, implement strict access controls
- **PCI DSS**: Isolate from cardholder data environments, implement strong authentication

Consult with your compliance team for specific requirements.

## Security Disclosure Policy

We believe in responsible disclosure and commit to:

1. Acknowledging receipt of vulnerability reports within 48 hours
2. Providing regular updates on remediation progress
3. Crediting reporters in security advisories (unless anonymity requested)
4. Coordinating public disclosure timing with reporters
5. Publishing security advisories for all confirmed vulnerabilities

## Contact

For security-related questions or concerns:

- **Security Issues**: security@autokube.io
- **General Questions**: Use GitHub Discussions
- **Commercial Support**: Contact your support representative

---

**Last Updated**: March 2026  
**Version**: 5.0
