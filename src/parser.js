import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'

export default class BillingParser {
    #log
    #parser

    /**
     * @param {import('pino').Logger} log
     */
    constructor(log) {
        this.#log = log
        this.#parser = new XMLParser({
            ignoreDeclaration: true,
            ignoreAttributes: true,
            parseAttributeValue: true,
            allowBooleanAttributes: true,
            removeNSPrefix: true,
            parseTagValue: true,
            trimValues: true,
            cdataPropName: '__cdata',
        })
    }

    /**
     * @param {import('..').BillingDocument} document
     * @param {import('..').Attachment | null | undefined} attachment
     * @returns {string}
     */
    #extractID(document, attachment) {
        return (
            attachment?.ID ??
            attachment?.Invoice?.ID ??
            attachment?.CreditNote?.ID ??
            (document.ParentDocumentID === 'null' ? null : document.ParentDocumentID ?? null) ??
            document.AltID ??
            document.ParentDocumentLineReference?.DocumentReference.ID ??
            document.ID ??
            ''
        )
    }

    /**
     *
     * @param {import('..').BillingDocument} document
     * @return {string}
     */
    #extractCUFE(document) {
        return document.UUID ?? document.ParentDocumentLineReference?.DocumentReference?.UUID ?? ''
    }

    /**
     *
     * @param {import('..').BillingDocumentEntity|undefined} entity
     * @return {{nit: string, nombre: string}}
     */
    #extractEntityData(entity) {
        return {
            nit: entity?.PartyTaxScheme.CompanyID ?? entity?.PartyTaxScheme.CompanyID ?? '',
            nombre: entity?.PartyTaxScheme.RegistrationName ?? entity?.PartyTaxScheme.RegistrationName ?? '',
        }
    }

    /**
     *
     * @param {Partial<import('..').Attachment>} attachment
     * @returns {number}
     */
    #extractValue(attachment) {
        return (
            attachment.Invoice?.LegalMonetaryTotal?.PayableAmount ?? attachment?.LegalMonetaryTotal?.PayableAmount ?? 0
        )
    }

    /**
     *
     * @param {import('..').BillingDocument} document
     * @returns {import('..').Attachment}
     */
    #extractAttachment(document) {
        return this.#parser.parse(
            document.Attachment.ExternalReference.Description.__cdata.replace('<![CDATA[', '').replace(']]', '')
        )
    }

    /**
     *
     * @param {import('..').BillingDocument} document
     * @returns {import('..').Billing}
     */
    #extractBilling(document) {
        const attachment = this.#extractAttachment(document)

        return {
            id: this.#extractID(document, attachment),
            cufe: this.#extractCUFE(document),
            date: document.IssueDate,
            value: this.#extractValue(attachment),
            proveedor: this.#extractEntityData(document.SenderParty ?? document.AccountingSupplierParty?.Party),
            cliente: this.#extractEntityData(document.ReceiverParty ?? document.AccountingCustomerParty?.Party),
        }
    }

    /**
     *
     * @param {import('..').Attachment} document
     * @returns {import('..').Billing}
     */
    #extractAttachmentBilling(document) {
        const attachment = this.#extractAttachment(document)

        return {
            id: this.#extractID(document, attachment),
            cufe: document.UUID,
            date: document.IssueDate,
            value: this.#extractValue(document),
            proveedor: this.#extractEntityData(document.AccountingSupplierParty.Party),
            cliente: this.#extractEntityData(document.AccountingCustomerParty.Party),
        }
    }

    /**
     *
     * @param {string|Buffer} path
     * @returns {Promise<import('..').BillingDocumentXML|null>}
     */
    async #parse(path) {
        const data = this.#parser.parse(await fs.readFile(path))

        if (!data) {
            return null
        }

        return data
    }

    /**
     *
     * @param {string} xmlPath
     * @returns {Promise<import('..').Billing|null>}
     * @throws {Error}
     */
    async #parseXML(xmlPath) {
        fs.access(xmlPath, constants.R_OK)

        const parsedXML = await this.#parse(xmlPath)

        if (!parsedXML) {
            throw new Error('El XML no pudo ser leido')
        }

        if (!(parsedXML.Invoice || parsedXML.AttachedDocument || parsedXML.CreditNote)) {
            throw new Error('El XML no contiene datos válidos')
        }

        try {
            if (parsedXML.Invoice) {
                console.log('Found an Invoice')
                this.#log.info('Found an Invoice')
                return this.#extractAttachmentBilling(parsedXML.Invoice)
            }

            if (parsedXML.CreditNote) {
                console.log('Found a Credit Note')
                this.#log.info('Found a Credit Note')
                return this.#extractAttachmentBilling(parsedXML.CreditNote)
            }

            if (parsedXML.AttachedDocument) {
                console.log('Found an AttachedDocument')
                this.#log.info('Found an AttachedDocument')
                return this.#extractBilling(parsedXML.AttachedDocument)
            }
        } catch (e) {
            this.#log.error(e, 'Error al leer los datos de la factura')
            throw new Error('Error al leer los datos de la factura')
        }

        return null
    }

    /**
     * Parse a XML UBL document and try to extract a Billing
     *
     * @param {string} xmlPath
     * @returns {Promise<import('..').Billing|null>}
     */
    async parse(xmlPath) {
        const data = await this.#parseXML(xmlPath)

        if (!data.id) {
            throw new Error('La factura no tiene un ID')
        }

        return data
    }
}
