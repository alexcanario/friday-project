# Pacote de contexto: frontend

## Regras
- Escreva primeiro o teste xUnit de cada critério e confirme que ele falha pelo motivo certo.
- Em Blazor, a lógica de página e de componente fica em classes C# comuns, testáveis por xUnit; o arquivo `.razor` só liga a marcação a essa lógica.
- Não use biblioteca de teste de componente e não adicione dependência que a issue não nomeia.
- Rode exatamente `dotnet test`, sem argumentos extras.

## Padrões
- Um componente por responsabilidade; parâmetros pelo atributo `[Parameter]`, estado em uma classe de modelo.
- Eventos da interface chamam métodos da classe de lógica, que devolvem o novo estado.
- Texto exibido ao usuário em português do Brasil, sem repetir a mesma frase em vários componentes.

## Ferramentas
- `dotnet restore`, `dotnet build` e `dotnet test` para compilar e testar.
- `git status` e `git diff` para revisar a própria mudança; o envio é feito por `git_push`.
- Teste de unidade com xUnit sobre a classe de lógica, sem renderizar o componente.

## Modelo
Exemplo de página Blazor com a lógica em uma classe testável:

```csharp
public sealed class FaqModel
{
    private readonly List<string> questions = ["Como pedir?", "Como pagar?"];

    public IReadOnlyList<string> Filter(string term) =>
        questions.Where(q => q.Contains(term, StringComparison.OrdinalIgnoreCase)).ToList();
}

// Pages/Faq.razor
// @page "/faq"
// @code { private readonly FaqModel model = new(); }

public class FaqModelTests
{
    [Fact]
    public void Filter_Term_ReturnsMatchingQuestions() =>
        Assert.Single(new FaqModel().Filter("pagar"));
}
```
